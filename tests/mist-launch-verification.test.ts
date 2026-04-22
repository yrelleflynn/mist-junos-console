import { describe, expect, it } from 'vitest';

import { evaluateMistLaunchVerification } from '../src/features/mist-launch/verification';

describe('evaluateMistLaunchVerification', () => {
  it('is inactive when there is no launch context', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: null,
      serialConnected: true,
      identity: null,
      matchedMistDeviceId: null,
    })).toEqual({
      active: false,
      state: 'inactive',
      unlocksWorkflow: true,
      mismatchField: null,
      reason: 'inactive',
    });
  });

  it('waits when the serial session is not connected', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceId: 'dev-1' },
      serialConnected: false,
      identity: null,
      matchedMistDeviceId: null,
    }).reason).toBe('not_connected');
  });

  it('waits when identity is not yet available', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceId: 'dev-1' },
      serialConnected: true,
      identity: null,
      matchedMistDeviceId: null,
    }).reason).toBe('identity_missing');
  });

  it('matches immediately when Mist device ids match', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceId: 'dev-1' },
      serialConnected: true,
      identity: { hostname: 'sw-a', serial: 'ABC123', mac: 'aa:bb:cc:dd:ee:ff', model: null, junosVersion: null },
      matchedMistDeviceId: 'dev-1',
    })).toMatchObject({
      state: 'matched',
      unlocksWorkflow: true,
      reason: 'mist_device_id_match',
    });
  });

  it('mismatches immediately when Mist device ids differ', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceId: 'dev-1' },
      serialConnected: true,
      identity: { hostname: 'sw-a', serial: 'ABC123', mac: 'aa:bb:cc:dd:ee:ff', model: null, junosVersion: null },
      matchedMistDeviceId: 'dev-2',
    })).toMatchObject({
      state: 'mismatch',
      unlocksWorkflow: false,
      reason: 'mist_device_id_mismatch',
    });
  });

  it('matches by serial or MAC or hostname when no Mist device id comparison is available', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceSerial: 'ABC123', deviceName: 'sw-a' },
      serialConnected: true,
      identity: { hostname: 'sw-a', serial: 'abc123', mac: null, model: null, junosVersion: null },
      matchedMistDeviceId: null,
    })).toMatchObject({
      state: 'matched',
      unlocksWorkflow: true,
      reason: 'identity_match',
    });
  });

  it('mismatches on the first conflicting identity field', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceSerial: 'ABC123', deviceName: 'sw-a' },
      serialConnected: true,
      identity: { hostname: 'sw-a', serial: 'XYZ999', mac: null, model: null, junosVersion: null },
      matchedMistDeviceId: null,
    })).toMatchObject({
      state: 'mismatch',
      unlocksWorkflow: false,
      reason: 'identity_mismatch',
      mismatchField: 'serial',
    });
  });

  it('waits when there is not enough comparable identity data yet', () => {
    expect(evaluateMistLaunchVerification({
      launchContext: { deviceId: 'opaque-device-id-without-mac' },
      serialConnected: true,
      identity: { hostname: null, serial: null, mac: null, model: null, junosVersion: null },
      matchedMistDeviceId: null,
    })).toMatchObject({
      state: 'waiting',
      unlocksWorkflow: false,
      reason: 'insufficient_data',
    });
  });
});
