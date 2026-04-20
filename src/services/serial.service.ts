/**
 * SerialService — Web Serial API abstraction layer
 *
 * Handles connect, disconnect, read stream, and write.
 * Provides typed events for data, connect, disconnect, and errors.
 * Designed to be consumed by UI components or automated scripts independently.
 */

export interface SerialOptions {
  baudRate: number;
  dataBits: 7 | 8;
  parity: ParityType;
  stopBits: 1 | 2;
  flowControl: FlowControlType;
}

export const DEFAULT_SERIAL_OPTIONS: SerialOptions = {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
};

type SerialEventMap = {
  /** Raw bytes from the device (RX). */
  data: Uint8Array;
  /** Raw bytes sent to the device (TX), for session mirroring / audit. */
  tx: Uint8Array;
  connect: void;
  disconnect: void;
  error: Error;
};

type SerialEventCallback<T> = (payload: T) => void;

export class SerialService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading = false;
  private uiSuppressionCount = 0;

  private listeners: {
    [K in keyof SerialEventMap]?: Set<SerialEventCallback<SerialEventMap[K]>>;
  } = {};

  /**
   * Check browser support for Web Serial API.
   */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  /**
   * Subscribe to an event.
   */
  on<K extends keyof SerialEventMap>(
    event: K,
    callback: SerialEventCallback<SerialEventMap[K]>,
  ): void {
    if (!this.listeners[event]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.listeners as any)[event] = new Set();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.listeners[event] as Set<any>).add(callback);
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends keyof SerialEventMap>(
    event: K,
    callback: SerialEventCallback<SerialEventMap[K]>,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const set = this.listeners[event] as Set<any> | undefined;
    if (set) set.delete(callback);
  }

  /**
   * Emit an event to all listeners.
   */
  private emit<K extends keyof SerialEventMap>(event: K, payload: SerialEventMap[K]): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const set = this.listeners[event] as Set<any> | undefined;
    if (set) {
      set.forEach((cb: SerialEventCallback<SerialEventMap[K]>) => cb(payload));
    }
  }

  /**
   * Prompt for a port, then open it. Prefer calling `navigator.serial.requestPort()` yourself
   * first (e.g. from a click handler) so it is the first `await` after the user gesture.
   */
  async connect(options: Partial<SerialOptions> = {}): Promise<void> {
    if (!SerialService.isSupported()) {
      throw new Error('Web Serial API not supported. Use Chrome or Edge.');
    }
    const port = await navigator.serial.requestPort();
    await this.openPort(port, options);
  }

  /**
   * Open a user-chosen `SerialPort` (already returned from `requestPort()`).
   */
  async openPort(port: SerialPort, options: Partial<SerialOptions> = {}): Promise<void> {
    if (this.port !== null) {
      throw new Error('Already connected. Disconnect first.');
    }

    const opts: SerialOptions = { ...DEFAULT_SERIAL_OPTIONS, ...options };

    this.port = port;
    await this.port.open({
      baudRate: opts.baudRate,
      dataBits: opts.dataBits,
      parity: opts.parity,
      stopBits: opts.stopBits,
      flowControl: opts.flowControl,
    });

    if (!this.port.writable) throw new Error('Port is not writable.');
    this.writer = this.port.writable.getWriter();

    if (!this.port.readable) throw new Error('Port is not readable.');
    this.reader = this.port.readable.getReader();

    this.reading = true;
    this.readLoop();

    this.emit('connect', undefined);
  }

  /**
   * Continuous read loop — emits raw Uint8Array data chunks.
   */
  private async readLoop(): Promise<void> {
    try {
      while (this.reading && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.emit('data', value);
        }
      }
    } catch (err) {
      if (this.reading) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /**
   * Send raw bytes over the serial connection.
   */
  /**
   * @param emitTx — When false, skips the `tx` event (e.g. bytes injected from a remote support session).
   */
  async writeBytes(data: Uint8Array, emitTx = true): Promise<void> {
    if (!this.writer) throw new Error('Not connected.');
    await this.writer.write(data);
    if (emitTx) this.emit('tx', new Uint8Array(data));
  }

  /**
   * Send a string over the serial connection (encoded as UTF-8).
   */
  async writeString(data: string, emitTx = true): Promise<void> {
    const encoder = new TextEncoder();
    await this.writeBytes(encoder.encode(data), emitTx);
  }

  /**
   * Close the serial connection and clean up.
   */
  async disconnect(): Promise<void> {
    this.reading = false;

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
    } catch { /* ignore */ }

    try {
      if (this.writer) {
        await this.writer.close();
        this.writer.releaseLock();
        this.writer = null;
      }
    } catch { /* ignore */ }

    try {
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch { /* ignore */ }

    this.emit('disconnect', undefined);
  }

  /**
   * Whether we currently have an open port.
   */
  get isConnected(): boolean {
    return this.port !== null && this.reading;
  }

  beginUiDataSuppression(): void {
    this.uiSuppressionCount += 1;
  }

  endUiDataSuppression(): void {
    this.uiSuppressionCount = Math.max(0, this.uiSuppressionCount - 1);
  }

  get isUiDataSuppressed(): boolean {
    return this.uiSuppressionCount > 0;
  }
}
