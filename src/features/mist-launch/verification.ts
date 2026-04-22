import type { SwitchIdentity } from '../../services/switch-identity.service';
import type { MistLaunchOverlay } from '../../services/mist-api.service';

export type MistLaunchVerificationState = 'inactive' | 'waiting' | 'matched' | 'mismatch';

export type MistLaunchVerificationReason =
  | 'inactive'
  | 'not_connected'
  | 'identity_missing'
  | 'mist_device_id_match'
  | 'mist_device_id_mismatch'
  | 'identity_match'
  | 'identity_mismatch'
  | 'insufficient_data';

export interface MistLaunchVerificationDecision {
  active: boolean;
  state: MistLaunchVerificationState;
  unlocksWorkflow: boolean;
  mismatchField: 'serial' | 'MAC' | 'hostname' | null;
  reason: MistLaunchVerificationReason;
}

export interface MistLaunchVerificationInput {
  launchContext: MistLaunchOverlay | null;
  serialConnected: boolean;
  identity: SwitchIdentity | null;
  matchedMistDeviceId?: string | null;
}

function normalizeLooseId(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return cleaned || null;
}

function normalizeHexId(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return cleaned || null;
}

function extractMistDeviceIdSuffix(deviceId: string | null | undefined): string | null {
  const normalized = normalizeHexId(deviceId);
  if (!normalized || normalized.length < 12) return null;
  return normalized.slice(-12);
}

export function evaluateMistLaunchVerification(input: MistLaunchVerificationInput): MistLaunchVerificationDecision {
  const { launchContext, serialConnected, identity, matchedMistDeviceId } = input;

  if (!launchContext) {
    return {
      active: false,
      state: 'inactive',
      unlocksWorkflow: true,
      mismatchField: null,
      reason: 'inactive',
    };
  }

  if (!serialConnected) {
    return {
      active: true,
      state: 'waiting',
      unlocksWorkflow: false,
      mismatchField: null,
      reason: 'not_connected',
    };
  }

  if (!identity) {
    return {
      active: true,
      state: 'waiting',
      unlocksWorkflow: false,
      mismatchField: null,
      reason: 'identity_missing',
    };
  }

  const expectedMistDeviceId = launchContext.deviceId ?? null;
  if (matchedMistDeviceId && expectedMistDeviceId) {
    if (matchedMistDeviceId === expectedMistDeviceId) {
      return {
        active: true,
        state: 'matched',
        unlocksWorkflow: true,
        mismatchField: null,
        reason: 'mist_device_id_match',
      };
    }
    return {
      active: true,
      state: 'mismatch',
      unlocksWorkflow: false,
      mismatchField: null,
      reason: 'mist_device_id_mismatch',
    };
  }

  const comparisons: Array<{ label: 'serial' | 'MAC' | 'hostname'; matched: boolean }> = [];

  const expectedSerial = normalizeLooseId(launchContext.deviceSerial);
  const actualSerial = normalizeLooseId(identity.serial);
  if (expectedSerial && actualSerial) {
    comparisons.push({ label: 'serial', matched: expectedSerial === actualSerial });
  }

  const actualMac = normalizeHexId(identity.mac);
  const expectedMac = normalizeHexId(launchContext.deviceMac);
  if (expectedMac && actualMac) {
    comparisons.push({ label: 'MAC', matched: expectedMac === actualMac });
  }

  const expectedMacSuffix = extractMistDeviceIdSuffix(launchContext.deviceId);
  if (expectedMacSuffix && actualMac) {
    comparisons.push({ label: 'MAC', matched: expectedMacSuffix === actualMac.slice(-12) });
  }

  const expectedHostname = normalizeLooseId(launchContext.deviceName);
  const actualHostname = normalizeLooseId(identity.hostname);
  if (expectedHostname && actualHostname) {
    comparisons.push({ label: 'hostname', matched: expectedHostname === actualHostname });
  }

  const mismatch = comparisons.find((comparison) => !comparison.matched);
  if (mismatch) {
    return {
      active: true,
      state: 'mismatch',
      unlocksWorkflow: false,
      mismatchField: mismatch.label,
      reason: 'identity_mismatch',
    };
  }

  if (comparisons.length > 0) {
    return {
      active: true,
      state: 'matched',
      unlocksWorkflow: true,
      mismatchField: null,
      reason: 'identity_match',
    };
  }

  return {
    active: true,
    state: 'waiting',
    unlocksWorkflow: false,
    mismatchField: null,
    reason: 'insufficient_data',
  };
}
