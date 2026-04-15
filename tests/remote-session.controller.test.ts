import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  class MockConsoleSessionService {
    static instances: MockConsoleSessionService[] = [];

    isOpen = true;
    clientRole: 'operator' | 'support' | null = 'operator';
    id: string | null = 'session-123';
    onJoined: ((sessionId: string, role: 'operator' | 'support') => void) | null = null;
    onRemoteSerialTx: ((data: Uint8Array) => void) | null = null;
    onSessionEnded: ((reason: string) => void) | null = null;
    onError: ((message: string) => void) | null = null;
    startAsOperator = vi.fn();
    sendSerialRx = vi.fn();
    sendSerialTx = vi.fn();
    close = vi.fn(() => {
      this.isOpen = false;
      this.id = null;
      this.clientRole = null;
    });

    constructor() {
      MockConsoleSessionService.instances.push(this);
    }
  }

  return { MockConsoleSessionService };
});

vi.mock('../src/services/console-session.service', () => ({
  ConsoleSessionService: mockState.MockConsoleSessionService,
}));

import { RemoteSessionController } from '../src/controllers/remote-session.controller';

function createSerialStub(isConnected = true) {
  return {
    isConnected,
    writeBytes: vi.fn().mockResolvedValue(undefined),
  };
}

function createCallbacks() {
  return {
    onSessionStarted: vi.fn(),
    onSessionEnded: vi.fn(),
    onError: vi.fn(),
  };
}

describe('RemoteSessionController', () => {
  beforeEach(() => {
    mockState.MockConsoleSessionService.instances.length = 0;
    vi.clearAllMocks();
  });

  it('starts an operator session and forwards the joined session id', () => {
    const serial = createSerialStub();
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();

    expect(mockState.MockConsoleSessionService.instances).toHaveLength(1);
    const session = mockState.MockConsoleSessionService.instances[0];
    expect(session.startAsOperator).toHaveBeenCalledTimes(1);

    session.onJoined?.('session-abc', 'operator');

    expect(callbacks.onSessionStarted).toHaveBeenCalledWith('session-abc');
  });

  it('tears down an existing session before starting a new one', () => {
    const serial = createSerialStub();
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const first = mockState.MockConsoleSessionService.instances[0];

    controller.startAsOperator();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(mockState.MockConsoleSessionService.instances).toHaveLength(2);
    expect(mockState.MockConsoleSessionService.instances[1].startAsOperator).toHaveBeenCalledTimes(1);
  });

  it('writes remote support keystrokes to the serial port without emitting local tx', async () => {
    const serial = createSerialStub(true);
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const session = mockState.MockConsoleSessionService.instances[0];
    const bytes = new Uint8Array([65, 66, 67]);

    session.onRemoteSerialTx?.(bytes);
    await Promise.resolve();

    expect(serial.writeBytes).toHaveBeenCalledWith(bytes, false);
  });

  it('does not write remote support keystrokes when serial is disconnected', async () => {
    const serial = createSerialStub(false);
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const session = mockState.MockConsoleSessionService.instances[0];

    session.onRemoteSerialTx?.(new Uint8Array([88]));
    await Promise.resolve();

    expect(serial.writeBytes).not.toHaveBeenCalled();
  });

  it('mirrors serial rx only for an open operator session', () => {
    const serial = createSerialStub();
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const session = mockState.MockConsoleSessionService.instances[0];
    const bytes = new Uint8Array([1, 2, 3]);

    controller.mirrorSerialRx(bytes);
    expect(session.sendSerialRx).toHaveBeenCalledWith(bytes);

    session.sendSerialRx.mockClear();
    session.clientRole = 'support';
    controller.mirrorSerialRx(bytes);
    expect(session.sendSerialRx).not.toHaveBeenCalled();
  });

  it('mirrors serial tx as operator input for an open session', () => {
    const serial = createSerialStub();
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const session = mockState.MockConsoleSessionService.instances[0];
    const bytes = new Uint8Array([4, 5, 6]);

    controller.mirrorSerialTx(bytes);

    expect(session.sendSerialTx).toHaveBeenCalledWith('operator', bytes);
  });

  it('propagates session end and tears down the session', () => {
    const serial = createSerialStub();
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const session = mockState.MockConsoleSessionService.instances[0];

    session.onSessionEnded?.('operator-disconnected');

    expect(callbacks.onSessionEnded).toHaveBeenCalledWith('operator-disconnected');
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(controller.isActive).toBe(false);
    expect(controller.sessionId).toBeNull();
  });

  it('propagates errors and tears down the session', () => {
    const serial = createSerialStub();
    const callbacks = createCallbacks();
    const controller = new RemoteSessionController(serial as never, callbacks);

    controller.startAsOperator();
    const session = mockState.MockConsoleSessionService.instances[0];

    session.onError?.('WebSocket error');

    expect(callbacks.onError).toHaveBeenCalledWith('WebSocket error');
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(controller.isActive).toBe(false);
  });
});
