/**
 * command-runner.service.ts — Junos CLI command execution over serial
 *
 * Sends commands to the serial connection and captures the response.
 * Handles prompt detection, pagination (--More--), and timeouts.
 * Designed to be used by automated troubleshooting tools.
 */

import { SerialService } from './serial.service';

export interface CommandResult {
  command: string;
  output: string;
  success: boolean;
  error?: string;
}

export interface CommandExecutionOptions {
  silent?: boolean;
}

export interface WaitForOptions {
  silent?: boolean;
}

/** Common Junos CLI prompt patterns */
export const PROMPT_PATTERNS = [
  /[\w\-@.:]+>\s*$/,       // operational mode: user@switch>
  /[\w\-@.:]+#\s*$/,       // config mode: user@switch#
  /[\w\-@.:]+%\s*$/,       // shell mode: root@switch%
  /login:\s*$/,            // login prompt
  /[Pp]assword:\s*$/,      // password prompt
];

export const MORE_PATTERN = /---\(more\s*\d*%?\)---/i;
export const MORE_PATTERN_ALT = /--\(more\)--/i;

/**
 * Strip the echoed command from the beginning of captured output,
 * remove surrounding blank lines, and drop the trailing prompt line.
 *
 * This is extracted as a pure function so it can be tested without a real
 * serial connection.
 */
export function stripCommandEcho(raw: string, command: string): string {
  let output = raw;
  const cmdIndex = output.indexOf(command);
  if (cmdIndex !== -1) {
    output = output.substring(cmdIndex + command.length);
  }
  // Strip leading/trailing whitespace and newlines
  output = output.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  // Strip the trailing prompt line
  const lines = output.split('\n');
  if (lines.length > 0 && PROMPT_PATTERNS.some((p) => p.test(lines[lines.length - 1]))) {
    lines.pop();
  }
  return lines.join('\n').trimEnd();
}

/**
 * Return true if the trimmed buffer ends with a recognised Junos CLI prompt.
 */
export function endsWithPrompt(buffer: string): boolean {
  return PROMPT_PATTERNS.some((p) => p.test(buffer.trimEnd()));
}

/**
 * Return true if the buffer contains a --More-- pagination marker.
 */
export function containsMorePrompt(buffer: string): boolean {
  return MORE_PATTERN.test(buffer) || MORE_PATTERN_ALT.test(buffer);
}

export class CommandRunnerService {
  private serial: SerialService;
  private outputBuffer = '';
  private dataHandler: ((data: Uint8Array) => void) | null = null;

  constructor(serial: SerialService) {
    this.serial = serial;
  }

  /**
   * Execute a single Junos CLI command and return the output.
   * Automatically handles --More-- pagination.
   *
   * @param command — The CLI command to execute
   * @param timeoutMs — Max time to wait for output (default 15s)
   * @param promptWait — Time to wait after last data for prompt detection (default 1s)
   */
  async execute(
    command: string,
    timeoutMs = 20000,
    promptWait = 2000,
    options: CommandExecutionOptions = {},
  ): Promise<CommandResult> {
    if (!this.serial.isConnected) {
      return { command, output: '', success: false, error: 'Not connected' };
    }

    return new Promise<CommandResult>((resolve) => {
      this.outputBuffer = '';
      let settled = false;
      let lastDataTime = Date.now();
      let checkInterval: ReturnType<typeof setInterval>;

      const cleanup = () => {
        if (this.dataHandler) {
          this.serial.off('data', this.dataHandler);
          this.dataHandler = null;
        }
        if (options.silent) {
          this.serial.endUiDataSuppression();
        }
        clearInterval(checkInterval);
        clearTimeout(absoluteTimeout);
      };

      const finish = (success: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        cleanup();

        const output = stripCommandEcho(this.outputBuffer, command);
        resolve({ command, output, success, error });
      };

      // Listen for data
      const decoder = new TextDecoder();
      this.dataHandler = (data: Uint8Array) => {
        const text = decoder.decode(data, { stream: true });
        this.outputBuffer += text;
        lastDataTime = Date.now();

        // Handle --More-- pagination
        if (containsMorePrompt(this.outputBuffer)) {
          // Send space to get next page
          this.serial.writeString(' ', !options.silent).catch(() => {});
        }
      };
      this.serial.on('data', this.dataHandler);

      // Periodically check if we've received a prompt (output is complete)
      checkInterval = setInterval(() => {
        const elapsed = Date.now() - lastDataTime;
        if (elapsed >= promptWait && this.outputBuffer.length > 0) {
          if (endsWithPrompt(this.outputBuffer)) {
            finish(true);
          }
        }
      }, 200);

      // Absolute timeout
      const absoluteTimeout = setTimeout(() => {
        finish(false, `Command timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      // Send the command
      if (options.silent) {
        this.serial.beginUiDataSuppression();
      }
      this.serial.writeString(command + '\n', !options.silent).catch((err) => {
        finish(false, `Send error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  /**
   * Send a string without waiting for a response.
   * Useful for login credentials, confirmations, etc.
   */
  async send(text: string): Promise<void> {
    await this.serial.writeString(text);
  }

  /**
   * Send text and wait for a specific pattern in the output.
   * Returns all captured output.
   */
  async sendAndWaitFor(
    text: string,
    pattern: RegExp,
    timeoutMs = 10000,
    options: WaitForOptions = {},
  ): Promise<{ output: string; matched: boolean }> {
    if (!this.serial.isConnected) {
      return { output: '', matched: false };
    }

    return new Promise((resolve) => {
      let buffer = '';
      let settled = false;
      const decoder = new TextDecoder();

      const handler = (data: Uint8Array) => {
        buffer += decoder.decode(data, { stream: true });
        if (pattern.test(buffer)) {
          done(true);
        }
      };

      const done = (matched: boolean) => {
        if (settled) return;
        settled = true;
        this.serial.off('data', handler);
        if (options.silent) {
          this.serial.endUiDataSuppression();
        }
        clearTimeout(timeout);
        resolve({ output: buffer, matched });
      };

      this.serial.on('data', handler);

      const timeout = setTimeout(() => done(false), timeoutMs);

      if (options.silent) {
        this.serial.beginUiDataSuppression();
      }
      this.serial.writeString(text, !options.silent).catch(() => done(false));
    });
  }

  /**
   * Attempt to log in to the Junos CLI.
   * Sends Enter first to trigger the login prompt, then credentials.
   */
  async login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    // Send Enter to trigger prompt
    const initial = await this.sendAndWaitFor('\n', /login:|>|#|%/, 5000);

    if (/>\s*$|#\s*$|%\s*$/.test(initial.output)) {
      // Already logged in
      return { success: true };
    }

    if (!initial.matched || !/login:/i.test(initial.output)) {
      return { success: false, error: 'Did not get login prompt' };
    }

    // Send username
    const userResult = await this.sendAndWaitFor(username + '\n', /[Pp]assword:/, 5000);
    if (!userResult.matched) {
      return { success: false, error: 'Did not get password prompt' };
    }

    // Send password
    const passResult = await this.sendAndWaitFor(password + '\n', />|#|%|login:/, 10000);
    if (!passResult.matched) {
      return { success: false, error: 'Login timed out' };
    }

    if (/login:/i.test(passResult.output)) {
      return { success: false, error: 'Login failed — invalid credentials' };
    }

    return { success: true };
  }

  /**
   * Ensure we are in Junos operational mode (not config mode or shell).
   * Sends 'exit' if in config mode.
   */
  /**
   * Detect the current CLI mode by sending Enter and examining the prompt.
   * Returns: 'operational' | 'config' | 'shell' | 'login' | 'unknown'
   */
  async detectMode(options: WaitForOptions = {}): Promise<'operational' | 'config' | 'shell' | 'login' | 'unknown'> {
    const result = await this.sendAndWaitFor('\n', />\s*$|#\s*$|%\s*$|login:/i, 3000, options);
    const output = result.output.trim();

    if (/login:\s*$/i.test(output)) return 'login';
    if (/#\s*$/.test(output)) return 'config';
    if (/%\s*$/.test(output)) return 'shell';
    if (/>\s*$/.test(output)) return 'operational';
    return 'unknown';
  }

  /**
   * Ensure the CLI is in Junos operational mode.
   * Exits config mode or shell if needed.
   */
  async ensureOperationalMode(options: CommandExecutionOptions = {}): Promise<void> {
    const mode = await this.detectMode(options);

    if (mode === 'config') {
      // Exit config mode without committing
      await this.execute('exit', 5000, 2000, options);
      // Check if we're still in config (nested edit levels)
      const mode2 = await this.detectMode(options);
      if (mode2 === 'config') {
        await this.execute('top', 3000, 2000, options);
        await this.execute('exit', 5000, 2000, options);
      }
    } else if (mode === 'shell') {
      // Exit shell, then enter CLI
      await this.sendAndWaitFor('exit\n', />\s*$|#\s*$|login:/i, 3000, options);
      await new Promise((r) => setTimeout(r, 1000));
      await this.sendAndWaitFor('cli\n', />\s*$|#\s*$|login:/i, 5000, options);
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Disable pagination
    await this.execute('set cli screen-length 0', 5000, 2000, options);
  }

  /**
   * Ensure the CLI is in Junos configuration mode.
   * Enters config mode from operational mode, or exits shell first if needed.
   */
  async ensureConfigMode(): Promise<void> {
    const mode = await this.detectMode();

    if (mode === 'config') {
      // Already in config mode — go to top level
      await this.execute('top', 3000);
      return;
    }

    if (mode === 'shell') {
      await this.send('exit\n');
      await new Promise((r) => setTimeout(r, 1000));
      await this.send('cli\n');
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Now in operational mode — enter config
    await this.execute('configure', 5000);
  }
}
