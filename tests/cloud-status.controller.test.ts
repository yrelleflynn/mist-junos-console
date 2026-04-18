import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudStatusController } from '../src/controllers/cloud-status.controller';
import type { MistMatchResult } from '../src/services/switch-identity.service';
import type { JmaConnectivityStatus } from '../src/types/cloud-status.types';

function makeMatchResult(overrides: Partial<MistMatchResult> = {}): MistMatchResult {
  return {
    identity: {
      hostname: 'sw-test',
      serial: 'ABC123',
      mac: 'aa:bb:cc:dd:ee:ff',
      model: 'EX2300-C-12T',
      junosVersion: '23.4R2-S6.6',
    },
    mistDevice: {
      id: 'dev-1',
      mac: 'aa:bb:cc:dd:ee:ff',
      serial: 'ABC123',
      model: 'EX2300-C-12T',
      type: 'switch',
      site_id: 'site-1',
    },
    mistConfig: null,
    matchedBy: 'serial',
    ...overrides,
  };
}

function makeJmaState(overrides: Partial<JmaConnectivityStatus> = {}): JmaConnectivityStatus {
  return {
    code: 111,
    name: 'Connected',
    severity: 'pass',
    label: '111 Connected',
    message: 'Agent connected to controller',
    errno: 0,
    detail: 'The switch reports a healthy authenticated Mist cloud connection.',
    ...overrides,
  };
}

function createSwitchIdentityStub(refreshed: Partial<MistMatchResult> = {}) {
  return {
    refreshMistCloudStatus: vi.fn().mockImplementation(async (result: MistMatchResult) => ({
      ...result,
      ...refreshed,
    })),
  };
}

function createTroubleshooterStub(jmaState = makeJmaState()) {
  return {
    getJmaConnectivityState: vi.fn().mockResolvedValue(jmaState),
  };
}

describe('CloudStatusController', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let switchIdentity: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let troubleshooter: any;
  const onStatusUpdated = vi.fn();
  let controller: CloudStatusController;

  beforeEach(() => {
    vi.useRealTimers();
    switchIdentity = createSwitchIdentityStub();
    troubleshooter = createTroubleshooterStub();
    onStatusUpdated.mockReset();
    controller = new CloudStatusController(switchIdentity, troubleshooter, {
      onStatusUpdated,
    });
  });

  it('refresh() builds connected Mist and JMA status when both are available', async () => {
    switchIdentity = createSwitchIdentityStub({
      mistCloudReachableHint: true,
      mistCloudStatusLine: 'Mist reports the switch as cloud-reachable.',
      mistLastSeenUtcIso: '2026-04-15T07:10:00Z',
      mistLastConfigUtcIso: '2026-04-15T06:59:00Z',
    });
    controller = new CloudStatusController(switchIdentity, troubleshooter, { onStatusUpdated });

    const matchResult = makeMatchResult({
      mistCloudReachableHint: false,
    });

    await controller.refresh(matchResult, true);

    expect(switchIdentity.refreshMistCloudStatus).toHaveBeenCalledWith(matchResult.mistDevice);
    expect(troubleshooter.getJmaConnectivityState).toHaveBeenCalledTimes(1);
    expect(controller.state.matchResult).toBe(matchResult);
    expect(controller.state.mist.pillState).toBe('connected');
    expect(controller.state.jma.label).toBe('111 Connected');
    expect(controller.state.lastUpdatedUtcIso).toBeTruthy();
    expect(onStatusUpdated).toHaveBeenCalledTimes(1);
  });

  it('refresh() reports disconnected Mist state when Mist says the switch is offline', async () => {
    switchIdentity = createSwitchIdentityStub({
      mistInventoryConnected: false,
      mistStatsStatus: 'disconnected',
      mistCloudStatusLine: 'Mist reports the switch as disconnected.',
    });
    controller = new CloudStatusController(switchIdentity, troubleshooter, { onStatusUpdated });

    await controller.refresh(makeMatchResult(), true);

    expect(controller.state.mist.pillState).toBe('disconnected');
    expect(controller.state.mist.label).toBe('Disconnected');
  });

  it('refresh() skips JMA polling when serial is disconnected', async () => {
    await controller.refresh(makeMatchResult(), false);

    expect(troubleshooter.getJmaConnectivityState).not.toHaveBeenCalled();
    expect(controller.state.jma.detail).toContain('Serial connection is not active');
  });

  it('refresh() returns an unknown Mist state when there is no matched Mist device', async () => {
    const unmatched = makeMatchResult({ mistDevice: null, matchedBy: null });
    await controller.refresh(unmatched, true);

    expect(switchIdentity.refreshMistCloudStatus).not.toHaveBeenCalled();
    expect(controller.state.mist.label).toBe('Unknown');
    expect(controller.state.mist.detail).toContain('Identify and match');
  });

  it('startPolling() refreshes on the interval when match and serial state are available', async () => {
    vi.useFakeTimers();
    const matchResult = makeMatchResult();

    controller.startPolling(() => matchResult, () => true, () => true, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(switchIdentity.refreshMistCloudStatus).toHaveBeenCalledTimes(2);
    expect(troubleshooter.getJmaConnectivityState).toHaveBeenCalledTimes(2);
  });

  it('startPolling() still refreshes JMA state when serial is connected but no Mist match exists yet', async () => {
    vi.useFakeTimers();

    controller.startPolling(() => null, () => true, () => true, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(switchIdentity.refreshMistCloudStatus).not.toHaveBeenCalled();
    expect(troubleshooter.getJmaConnectivityState).toHaveBeenCalledTimes(1);
    expect(controller.state.matchResult).toBeNull();
    expect(controller.state.lastUpdatedUtcIso).toBeTruthy();
  });

  it('pausePolling() suppresses refreshes until resumePolling() is called', async () => {
    vi.useFakeTimers();
    const matchResult = makeMatchResult();

    controller.startPolling(() => matchResult, () => true, () => true, 1000);
    controller.pausePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(switchIdentity.refreshMistCloudStatus).not.toHaveBeenCalled();

    controller.resumePolling();
    await vi.advanceTimersByTimeAsync(1000);
    expect(switchIdentity.refreshMistCloudStatus).toHaveBeenCalledTimes(1);
  });

  it('reset() clears state and stops polling', async () => {
    vi.useFakeTimers();
    const matchResult = makeMatchResult();

    controller.startPolling(() => matchResult, () => true, () => true, 1000);
    controller.reset();
    await vi.advanceTimersByTimeAsync(2000);

    expect(switchIdentity.refreshMistCloudStatus).not.toHaveBeenCalled();
    expect(controller.state.matchResult).toBeNull();
    expect(controller.state.lastUpdatedUtcIso).toBeNull();
    expect(onStatusUpdated).toHaveBeenCalled();
  });

});
