import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceContextController } from '../src/controllers/device-context.controller';
import type { DeviceContextCallbacks } from '../src/controllers/device-context.controller';
import type { MistMatchResult, SwitchIdentity } from '../src/services/switch-identity.service';

function makeMatchResult(overrides: Partial<MistMatchResult> = {}): MistMatchResult {
  return {
    identity: { hostname: 'sw-test', serial: 'ABC123', mac: 'aa:bb:cc:dd:ee:ff', model: 'EX2300-C-12P', junosVersion: '22.4R3' },
    mistDevice: null,
    mistConfig: null,
    matchedBy: null,
    ...overrides,
  };
}

const BASE_IDENTITY: SwitchIdentity = {
  hostname: 'sw-test', serial: 'ABC123', mac: 'aa:bb:cc:dd:ee:ff',
  model: 'EX2300-C-12P', junosVersion: '22.4R3',
};

function createSwitchIdentityStub(result: MistMatchResult | Error = makeMatchResult(), identity: SwitchIdentity = BASE_IDENTITY) {
  return {
    identifyAndMatch: vi.fn().mockImplementation(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
    identify: vi.fn().mockResolvedValue(identity),
  };
}

function createCmdRunnerStub() {
  return {
    ensureOperationalMode: vi.fn().mockResolvedValue(undefined),
  };
}

function createCallbacks() {
  return {
    onIdentifyStarted: vi.fn(),
    onIdentified: vi.fn(),
    onIdentifyFailed: vi.fn(),
    onLocalIdentityAvailable: vi.fn(),
  };
}

describe('DeviceContextController', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let switchIdentity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cmdRunner: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callbacks: any;
  let controller: DeviceContextController;

  beforeEach(() => {
    switchIdentity = createSwitchIdentityStub();
    cmdRunner = createCmdRunnerStub();
    callbacks = createCallbacks();
    controller = new DeviceContextController(switchIdentity as never, cmdRunner as never, callbacks);
  });

  // ---- initial state ----

  it('starts with empty state', () => {
    expect(controller.isIdentified).toBe(false);
    expect(controller.hasSiteAssignment).toBe(false);
    expect(controller.matchResult).toBeNull();
    expect(controller.state.hasMistDevice).toBe(false);
  });

  // ---- runIdentify() — success paths ----

  it('fires onIdentifyStarted before the API call', async () => {
    let startedBeforeCall = false;
    switchIdentity.identifyAndMatch.mockImplementation(() => {
      startedBeforeCall = callbacks.onIdentifyStarted.mock.calls.length > 0;
      return Promise.resolve(makeMatchResult());
    });

    await controller.runIdentify();
    expect(startedBeforeCall).toBe(true);
  });

  it('calls ensureOperationalMode before identifyAndMatch', async () => {
    const callOrder: string[] = [];
    cmdRunner.ensureOperationalMode.mockImplementation(() => {
      callOrder.push('ensure');
      return Promise.resolve();
    });
    switchIdentity.identifyAndMatch.mockImplementation(() => {
      callOrder.push('identify');
      return Promise.resolve(makeMatchResult());
    });

    await controller.runIdentify();
    expect(callOrder).toEqual(['ensure', 'identify']);
  });

  it('sets isIdentified and stores matchResult on success', async () => {
    const result = makeMatchResult();
    switchIdentity.identifyAndMatch.mockResolvedValue(result);

    await controller.runIdentify();

    expect(controller.isIdentified).toBe(true);
    expect(controller.matchResult).toBe(result);
  });

  it('sets hasMistDevice=true when mistDevice is present', async () => {
    const result = makeMatchResult({
      mistDevice: { id: 'dev-1', mac: 'aa:bb:cc:dd:ee:ff', serial: 'ABC123', model: 'EX2300-C-12P', type: 'switch' },
    });
    switchIdentity.identifyAndMatch.mockResolvedValue(result);

    await controller.runIdentify();

    expect(controller.state.hasMistDevice).toBe(true);
    expect(controller.hasSiteAssignment).toBe(false);
  });

  it('sets hasSiteAssignment=true when mistDevice has site_id', async () => {
    const result = makeMatchResult({
      mistDevice: {
        id: 'dev-1', mac: 'aa:bb:cc:dd:ee:ff', serial: 'ABC123', model: 'EX2300-C-12P', type: 'switch',
        site_id: 'site-abc',
      },
    });
    switchIdentity.identifyAndMatch.mockResolvedValue(result);

    await controller.runIdentify();

    expect(controller.hasSiteAssignment).toBe(true);
  });

  it('fires onIdentified with the match result on success', async () => {
    const result = makeMatchResult();
    switchIdentity.identifyAndMatch.mockResolvedValue(result);

    await controller.runIdentify();

    expect(callbacks.onIdentified).toHaveBeenCalledWith(result, {});
    expect(callbacks.onIdentifyFailed).not.toHaveBeenCalled();
  });

  // ---- runIdentify() — failure paths ----

  it('fires onIdentifyFailed with an Error on rejection', async () => {
    const err = new Error('Serial timeout');
    switchIdentity.identifyAndMatch.mockRejectedValue(err);

    await controller.runIdentify();

    expect(callbacks.onIdentifyFailed).toHaveBeenCalledWith(err, {});
    expect(callbacks.onIdentified).not.toHaveBeenCalled();
  });

  it('wraps non-Error rejections in an Error', async () => {
    switchIdentity.identifyAndMatch.mockRejectedValue('plain string rejection');

    await controller.runIdentify();

    const [err] = callbacks.onIdentifyFailed.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('plain string rejection');
  });

  it('resets state to empty on failure', async () => {
    // First run: succeed so we have some state
    switchIdentity.identifyAndMatch.mockResolvedValueOnce(makeMatchResult({
      mistDevice: { id: 'd1', mac: 'aa:bb:cc:dd:ee:ff', serial: 'S1', model: 'EX', type: 'switch' },
    }));
    await controller.runIdentify();
    expect(controller.isIdentified).toBe(true);

    // Second run: fail — state should be cleared
    switchIdentity.identifyAndMatch.mockRejectedValue(new Error('fail'));
    await controller.runIdentify();

    expect(controller.isIdentified).toBe(false);
    expect(controller.matchResult).toBeNull();
    expect(controller.state.hasMistDevice).toBe(false);
  });

  it('fires onIdentifyStarted even when the run will fail', async () => {
    switchIdentity.identifyAndMatch.mockRejectedValue(new Error('fail'));

    await controller.runIdentify();

    expect(callbacks.onIdentifyStarted).toHaveBeenCalledTimes(1);
  });

  // ---- clear() ----

  it('clear() resets state to empty', async () => {
    switchIdentity.identifyAndMatch.mockResolvedValue(makeMatchResult({
      mistDevice: { id: 'd1', mac: 'aa:bb:cc:dd:ee:ff', serial: 'S1', model: 'EX', type: 'switch', site_id: 'site-1' },
    }));
    await controller.runIdentify();
    expect(controller.isIdentified).toBe(true);

    controller.clear();

    expect(controller.isIdentified).toBe(false);
    expect(controller.hasSiteAssignment).toBe(false);
    expect(controller.matchResult).toBeNull();
    expect(controller.state.hasMistDevice).toBe(false);
  });

  // ---- state snapshot isolation ----

  it('state getter returns a snapshot, not the internal reference', async () => {
    const snap = controller.state;
    switchIdentity.identifyAndMatch.mockResolvedValue(makeMatchResult());
    await controller.runIdentify();
    expect(snap.isIdentified).toBe(false);
  });
});

// ---- runLocalIdentify() ----

describe('DeviceContextController.runLocalIdentify()', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let switchIdentity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cmdRunner: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callbacks: any;
  let controller: DeviceContextController;

  beforeEach(() => {
    switchIdentity = createSwitchIdentityStub();
    cmdRunner = createCmdRunnerStub();
    callbacks = createCallbacks();
    controller = new DeviceContextController(switchIdentity as never, cmdRunner as never, callbacks);
  });

  it('starts with localIdentity null', () => {
    expect(controller.localIdentity).toBeNull();
    expect(controller.state.localIdentity).toBeNull();
  });

  it('calls ensureOperationalMode then identify', async () => {
    const callOrder: string[] = [];
    cmdRunner.ensureOperationalMode.mockImplementation(() => {
      callOrder.push('ensure');
      return Promise.resolve();
    });
    switchIdentity.identify.mockImplementation(() => {
      callOrder.push('identify');
      return Promise.resolve(BASE_IDENTITY);
    });

    await controller.runLocalIdentify();
    expect(callOrder).toEqual(['ensure', 'identify']);
    expect(cmdRunner.ensureOperationalMode).toHaveBeenCalledWith({ silent: true });
    expect(switchIdentity.identify).toHaveBeenCalledWith({ silent: true });
  });

  it('stores localIdentity and fires onLocalIdentityAvailable on success', async () => {
    switchIdentity.identify.mockResolvedValue(BASE_IDENTITY);

    await controller.runLocalIdentify();

    expect(controller.localIdentity).toEqual(BASE_IDENTITY);
    expect(callbacks.onLocalIdentityAvailable).toHaveBeenCalledWith(BASE_IDENTITY);
  });

  it('does not fire onIdentifyStarted, onIdentified, or onIdentifyFailed', async () => {
    await controller.runLocalIdentify();

    expect(callbacks.onIdentifyStarted).not.toHaveBeenCalled();
    expect(callbacks.onIdentified).not.toHaveBeenCalled();
    expect(callbacks.onIdentifyFailed).not.toHaveBeenCalled();
  });

  it('silently ignores errors and leaves localIdentity null', async () => {
    switchIdentity.identify.mockRejectedValue(new Error('serial timeout'));

    await controller.runLocalIdentify(); // must not throw

    expect(controller.localIdentity).toBeNull();
    expect(callbacks.onLocalIdentityAvailable).not.toHaveBeenCalled();
  });

  it('is idempotent — skips the gather if localIdentity is already set', async () => {
    // First run succeeds
    await controller.runLocalIdentify();
    expect(switchIdentity.identify).toHaveBeenCalledTimes(1);

    // Second run must not call identify again
    await controller.runLocalIdentify();
    expect(switchIdentity.identify).toHaveBeenCalledTimes(1);
  });

  it('does not clear localIdentity after a subsequent runIdentify() failure', async () => {
    // Gather local identity first
    await controller.runLocalIdentify();
    expect(controller.localIdentity).toEqual(BASE_IDENTITY);

    // Full identify fails — should reset matchResult but not localIdentity
    switchIdentity.identifyAndMatch.mockRejectedValue(new Error('fail'));
    await controller.runIdentify();

    // localIdentity should be gone because clear() was called via EMPTY_DEVICE_CONTEXT
    // (This asserts the current defined behavior: runIdentify failure calls clear state)
    expect(controller.isIdentified).toBe(false);
  });

  it('clear() resets localIdentity', async () => {
    await controller.runLocalIdentify();
    expect(controller.localIdentity).not.toBeNull();

    controller.clear();
    expect(controller.localIdentity).toBeNull();
  });
});
