import type { MistCloud } from '../../config/mist-clouds.config';
import { getCatalogCheck } from '../../config/check-catalog.config';
import type { CheckResult } from '../../services/troubleshoot.service';

export type BlockingConsoleTask = { kind: 'background' | 'user' | 'exclusive'; label: string } | null;

export type CatalogRunOptions<TProgress> = {
  cloud: MistCloud;
  uplinkPort: string;
  siteId?: string;
  deviceId?: string;
  jmaStateCode?: number | null;
  checkIds: string[];
  onProgress: TProgress;
};

type EffectiveMistTarget = {
  siteId: string | null;
  deviceId: string | null;
  orgId?: string | null;
};

export function getCatalogCheckAvailability(
  checkId: string,
  input: {
    serialConnected: boolean;
    catalogRunning: boolean;
    selectedCloud: MistCloud | null;
    effectiveTarget: EffectiveMistTarget;
    getBlockingConsoleTask: (ownerId: string) => BlockingConsoleTask;
  },
): { available: boolean; reason: string | null } {
  const check = getCatalogCheck(checkId);
  if (!check) return { available: false, reason: 'Unknown check.' };
  if (!input.serialConnected) {
    return { available: false, reason: 'Serial session is not connected.' };
  }
  if (input.catalogRunning) {
    return { available: false, reason: 'Another troubleshooting workflow is already running.' };
  }
  const blocking = input.getBlockingConsoleTask(`catalog-check:${checkId}`);
  if (blocking) {
    return { available: false, reason: `${blocking.label} is using the console.` };
  }
  if (check.requiresCloud && !input.selectedCloud) {
    return { available: false, reason: 'Select a Mist cloud region first.' };
  }
  if (check.requiresMistApi) {
    const hasSite = !!input.effectiveTarget.siteId;
    const hasDevice = !!input.effectiveTarget.deviceId;
    if (!hasSite || !hasDevice) {
      return { available: false, reason: 'Identify and match the switch in Mist first.' };
    }
  }
  return { available: true, reason: null };
}

export function canRunFullBaseline(input: {
  serialConnected: boolean;
  catalogRunning: boolean;
  selectedCloud: MistCloud | null;
  getBlockingConsoleTask: (ownerId: string) => BlockingConsoleTask;
}): boolean {
  return input.serialConnected
    && !input.catalogRunning
    && !input.getBlockingConsoleTask('full-baseline')
    && Boolean(input.selectedCloud);
}

export function resolveCatalogRunOptions<TProgress>(
  checkIds: string[],
  input: {
    selectedCloud: MistCloud | null;
    effectiveTarget: EffectiveMistTarget;
    uplinkPort: string;
    jmaStateCode?: number | null;
    onProgress: TProgress;
    cloudOverride?: MistCloud | null;
  },
): { options: CatalogRunOptions<TProgress> } | { error: string } {
  for (const checkId of checkIds) {
    const check = getCatalogCheck(checkId);
    if (!check) {
      return { error: `Unknown check: ${checkId}` };
    }
    if (check.requiresCloud && !(input.cloudOverride ?? input.selectedCloud)) {
      return { error: `Select a Mist cloud region before running ${check.name}.` };
    }
    if (check.requiresMistApi) {
      const hasSite = !!input.effectiveTarget.siteId;
      const hasDevice = !!input.effectiveTarget.deviceId;
      if (!hasSite || !hasDevice) {
        return { error: `${check.name} requires the switch to be identified and matched in Mist first.` };
      }
    }
  }

  const cloud = input.cloudOverride ?? input.selectedCloud;
  if (!cloud) {
    return { error: 'Select a Mist cloud region first.' };
  }

  return {
    options: {
      cloud,
      uplinkPort: input.uplinkPort,
      siteId: input.effectiveTarget.siteId || undefined,
      deviceId: input.effectiveTarget.deviceId || undefined,
      jmaStateCode: input.jmaStateCode ?? null,
      checkIds,
      onProgress: input.onProgress,
    },
  };
}

export type { CheckResult };
