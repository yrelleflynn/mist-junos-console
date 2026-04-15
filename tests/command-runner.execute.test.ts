import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRunnerService } from '../src/services/command-runner.service';

class FakeSerial {
  isConnected = true;
  private readonly listeners = new Set<(data: Uint8Array) => void>();
  private suppressionCount = 0;
  readonly writeString = vi.fn(async (text: string, emitTx = true) => {
    this.lastWrite = { text, emitTx };
    queueMicrotask(() => {
      if (text.startsWith('show version')) {
        this.emitText('show version\nJunos: 23.4R2-S6.6\nuser@switch> ');
      }
    });
  });
  lastWrite: { text: string; emitTx: boolean } | null = null;

  on(event: 'data', callback: (data: Uint8Array) => void): void {
    if (event === 'data') this.listeners.add(callback);
  }

  off(event: 'data', callback: (data: Uint8Array) => void): void {
    if (event === 'data') this.listeners.delete(callback);
  }

  beginUiDataSuppression(): void {
    this.suppressionCount += 1;
  }

  endUiDataSuppression(): void {
    this.suppressionCount = Math.max(0, this.suppressionCount - 1);
  }

  get isUiDataSuppressed(): boolean {
    return this.suppressionCount > 0;
  }

  private emitText(text: string): void {
    const bytes = new TextEncoder().encode(text);
    this.listeners.forEach((listener) => listener(bytes));
  }
}

describe('CommandRunnerService execute()', () => {
  let serial: FakeSerial;
  let runner: CommandRunnerService;

  beforeEach(() => {
    vi.useFakeTimers();
    serial = new FakeSerial();
    runner = new CommandRunnerService(serial as never);
  });

  it('runs silent commands without leaving UI suppression enabled and skips tx mirroring', async () => {
    const pending = runner.execute('show version', 1000, 10, { silent: true });

    expect(serial.isUiDataSuppressed).toBe(true);

    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.output).toContain('Junos: 23.4R2-S6.6');
    expect(serial.lastWrite).toEqual({ text: 'show version\n', emitTx: false });
    expect(serial.isUiDataSuppressed).toBe(false);
  });

  it('keeps normal commands visible by default', async () => {
    const pending = runner.execute('show version', 1000, 10);

    expect(serial.isUiDataSuppressed).toBe(false);

    await vi.advanceTimersByTimeAsync(250);
    await pending;

    expect(serial.lastWrite).toEqual({ text: 'show version\n', emitTx: true });
    expect(serial.isUiDataSuppressed).toBe(false);
  });
});
