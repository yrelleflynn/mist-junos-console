/**
 * TerminalComponent — xterm.js wrapper
 *
 * Manages the xterm.js Terminal instance, addons, theming, and resize behavior.
 * Provides a clean interface for the app to write data and listen for user input.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export interface TerminalOptions {
  fontSize?: number;
  fontFamily?: string;
  cursorBlink?: boolean;
}

const DEFAULT_THEME = {
  background: '#010409',
  foreground: '#e6edf3',
  cursor: '#41d87b',
  cursorAccent: '#010409',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#484f58',
  red: '#f97583',
  green: '#41d87b',
  yellow: '#e3b341',
  blue: '#79c0ff',
  magenta: '#bc8cff',
  cyan: '#56d4dd',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#a5d6ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#76e3ea',
  brightWhite: '#ffffff',
};

export class TerminalComponent {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;

  /**
   * Callback fired when the user types in the terminal.
   * Receives the raw string input (individual keystrokes or pasted text).
   */
  onInput: ((data: string) => void) | null = null;

  constructor(container: HTMLElement, options: TerminalOptions = {}) {
    this.container = container;

    this.terminal = new Terminal({
      fontSize: options.fontSize ?? 14,
      fontFamily: options.fontFamily ?? "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      cursorBlink: options.cursorBlink ?? true,
      theme: DEFAULT_THEME,
      convertEol: true,
      scrollback: 10000,
      allowProposedApi: true,
    });

    // Addons
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    // Mount
    this.terminal.open(this.container);
    this.fit();

    // Listen for user input — forward to callback
    this.terminal.onData((data: string) => {
      if (this.onInput) this.onInput(data);
    });

    // Auto-resize when container changes size
    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * Write data to the terminal display.
   * This is for received data (RX) — displayed as-is including ANSI codes.
   */
  write(data: string | Uint8Array): void {
    this.terminal.write(data);
  }

  /**
   * Write a line with a newline appended.
   */
  writeln(data: string): void {
    this.terminal.writeln(data);
  }

  /**
   * Write a styled system message.
   */
  writeSystem(message: string): void {
    // Dim/italic via ANSI
    this.terminal.writeln(`\x1b[2;3m${message}\x1b[0m`);
  }

  /**
   * Write an error message.
   */
  writeError(message: string): void {
    // Red via ANSI
    this.terminal.writeln(`\x1b[31m${message}\x1b[0m`);
  }

  /**
   * Clear the terminal.
   */
  clear(): void {
    this.terminal.clear();
  }

  /**
   * Focus the terminal input.
   */
  focus(): void {
    this.terminal.focus();
  }

  /**
   * Fit terminal to container dimensions.
   */
  fit(): void {
    try {
      this.fitAddon.fit();
    } catch {
      // Container may not be visible yet
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.resizeObserver.disconnect();
    this.terminal.dispose();
  }
}
