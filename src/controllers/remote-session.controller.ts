/**
 * remote-session.controller.ts — Operator-side remote console session workflow
 *
 * Extracted from src/main.ts so that the session lifecycle (create, mirror,
 * tear-down) can evolve independently of the main DOM wiring.
 *
 * The controller owns the ConsoleSessionService instance and exposes a narrow
 * interface. UI side-effects are delivered through the callbacks object so the
 * controller has no direct DOM dependency.
 */

import { SerialService } from '../services/serial.service';
import { ConsoleSessionService } from '../services/console-session.service';

/**
 * Callbacks that the controller invokes when session state changes.
 * The caller (main.ts) implements these to update the DOM.
 */
export interface RemoteSessionCallbacks {
  /** Session successfully joined the hub — display the session ID. */
  onSessionStarted(sessionId: string): void;
  /** Session ended for any reason — hide the panel and uncheck the toggle. */
  onSessionEnded(reason: string): void;
  /** An error occurred — show an error message and uncheck the toggle. */
  onError(message: string): void;
}

export class RemoteSessionController {
  private session: ConsoleSessionService | null = null;
  private readonly serial: SerialService;
  private readonly callbacks: RemoteSessionCallbacks;

  constructor(serial: SerialService, callbacks: RemoteSessionCallbacks) {
    this.serial = serial;
    this.callbacks = callbacks;
  }

  /** True while a session WebSocket is open. */
  get isActive(): boolean {
    return this.session?.isOpen ?? false;
  }

  /** The current session ID, or null if no session is active. */
  get sessionId(): string | null {
    return this.session?.id ?? null;
  }

  /**
   * Start a new operator session.
   * Any existing session is torn down first.
   */
  startAsOperator(): void {
    this.tearDown();

    const cs = new ConsoleSessionService();
    this.session = cs;

    cs.onJoined = (sessionId) => {
      this.callbacks.onSessionStarted(sessionId);
    };

    cs.onRemoteSerialTx = (data: Uint8Array) => {
      // Forward remote-injected keystrokes to the physical serial port
      if (this.serial.isConnected) {
        void this.serial.writeBytes(data, false);
      }
    };

    cs.onSessionEnded = (reason: string) => {
      this.callbacks.onSessionEnded(reason);
      this.tearDown();
    };

    cs.onError = (message: string) => {
      this.callbacks.onError(message);
      this.tearDown();
    };

    cs.startAsOperator();
  }

  /**
   * Mirror serial RX data (switch → browser) to the hub so support viewers
   * can see switch output.
   */
  mirrorSerialRx(data: Uint8Array): void {
    if (this.session?.isOpen && this.session.clientRole === 'operator') {
      this.session.sendSerialRx(data);
    }
  }

  /**
   * Mirror serial TX data (operator keystrokes → switch) to the hub so
   * support viewers can see what the operator is typing.
   */
  mirrorSerialTx(data: Uint8Array): void {
    if (this.session?.isOpen) {
      this.session.sendSerialTx('operator', data);
    }
  }

  /**
   * Close the active session and clear local state.
   * Safe to call when no session is active.
   */
  tearDown(): void {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}
