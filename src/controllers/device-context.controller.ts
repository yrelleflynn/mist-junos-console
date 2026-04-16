/**
 * device-context.controller.ts — Switch identify-and-match workflow
 *
 * Extracted from src/main.ts so that the switch identification workflow,
 * its resulting device state, and downstream feature enablement can be
 * reasoned about and tested independently of the DOM.
 *
 * The controller owns:
 *   - the current DeviceContextState (replaces `lastMatchResult` in main.ts)
 *   - calling SwitchIdentityService.identifyAndMatch()
 *   - ensuring operational CLI mode before identifying
 *
 * HTML rendering and button DOM manipulation stay in main.ts; they are driven
 * by the DeviceContextCallbacks object so the controller has no DOM dependency.
 */

import { SwitchIdentityService, MistMatchResult, SwitchIdentity } from '../services/switch-identity.service';
import { CommandRunnerService } from '../services/command-runner.service';
import { DeviceContextState, EMPTY_DEVICE_CONTEXT } from '../types/device-context.types';

/**
 * Callbacks the controller fires when identify state changes.
 * The caller (main.ts) implements these to update the DOM.
 */
export interface DeviceContextCallbacks {
  /** Identify run started — show loading indicator. */
  onIdentifyStarted(options?: { silent?: boolean }): void;
  /** Identify succeeded — render result HTML and update button states. */
  onIdentified(result: MistMatchResult, options?: { silent?: boolean }): void;
  /** Identify failed — show error. */
  onIdentifyFailed(error: Error, options?: { silent?: boolean }): void;
  /**
   * Background local identity is available (hostname, serial, MAC, model).
   * Fired by runLocalIdentify() — does not require Mist API to be configured.
   */
  onLocalIdentityAvailable(identity: SwitchIdentity): void;
}

export class DeviceContextController {
  private readonly switchIdentity: SwitchIdentityService;
  private readonly cmdRunner: CommandRunnerService;
  private readonly callbacks: DeviceContextCallbacks;
  private _state: DeviceContextState = { ...EMPTY_DEVICE_CONTEXT };

  constructor(
    switchIdentity: SwitchIdentityService,
    cmdRunner: CommandRunnerService,
    callbacks: DeviceContextCallbacks,
  ) {
    this.switchIdentity = switchIdentity;
    this.cmdRunner = cmdRunner;
    this.callbacks = callbacks;
  }

  /** Snapshot of the current device context state. */
  get state(): DeviceContextState {
    return { ...this._state };
  }

  /**
   * The last successful identify-and-match result, or null.
   * Replaces the `lastMatchResult` variable that was held in main.ts.
   */
  get matchResult(): MistMatchResult | null {
    return this._state.matchResult;
  }

  /** True after at least one successful identify run. */
  get isIdentified(): boolean {
    return this._state.isIdentified;
  }

  /** True when the identified device has a Mist site assignment. */
  get hasSiteAssignment(): boolean {
    return this._state.hasSiteAssignment;
  }

  /** Local device identity gathered silently from the console, or null if not yet gathered. */
  get localIdentity(): SwitchIdentity | null {
    return this._state.localIdentity;
  }

  /**
   * Run the full identify-and-match workflow.
   *
   * Fires onIdentifyStarted, then either onIdentified (success) or
   * onIdentifyFailed (error). Updates internal state in both cases.
   */
  async runIdentify(options: { silent?: boolean } = {}): Promise<void> {
    this.callbacks.onIdentifyStarted(options);
    try {
      await this.cmdRunner.ensureOperationalMode({ silent: options.silent });
      const result = await this.switchIdentity.identifyAndMatch({ silent: options.silent });
      this._state = {
        ...this._state,
        matchResult: result,
        isIdentified: true,
        hasMistDevice: result.mistDevice !== null,
        hasSiteAssignment: !!result.mistDevice?.site_id,
        // Promote the match identity to localIdentity if not already set.
        localIdentity: this._state.localIdentity ?? result.identity,
      };
      this.callbacks.onIdentified(result, options);
    } catch (err) {
      this._state = { ...EMPTY_DEVICE_CONTEXT };
      this.callbacks.onIdentifyFailed(
        err instanceof Error ? err : new Error(String(err)),
        options,
      );
    }
  }

  /**
   * Run a silent background identity gather — no Mist lookup, no terminal noise.
   *
   * Collects hostname, serial, MAC, model and Junos version from the console and
   * fires onLocalIdentityAvailable. Safe to call when a CLI prompt is first
   * detected; does nothing if local identity is already known.
   */
  async runLocalIdentify(): Promise<void> {
    if (this._state.localIdentity !== null) return; // already gathered
    try {
      await this.cmdRunner.ensureOperationalMode({ silent: true });
      const identity = await this.switchIdentity.identify({ silent: true });
      this._state = { ...this._state, localIdentity: identity };
      this.callbacks.onLocalIdentityAvailable(identity);
    } catch {
      // Silently ignore — this is a best-effort background operation.
    }
  }

  /**
   * Clear device context — called on serial disconnect so that stale state
   * does not carry over to the next connection.
   */
  clear(): void {
    this._state = { ...EMPTY_DEVICE_CONTEXT };
  }
}
