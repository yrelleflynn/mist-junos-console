import { describe, expect, it } from 'vitest';

import { MIST_CLOUDS } from '../src/config/mist-clouds.config';
import {
  canRunFullBaseline,
  getCatalogCheckAvailability,
  resolveCatalogRunOptions,
} from '../src/features/troubleshoot/catalog-availability';

const selectedCloud = MIST_CLOUDS[0];

describe('troubleshoot catalog availability', () => {
  it('blocks checks when serial is disconnected', () => {
    expect(getCatalogCheckAvailability('lldp', {
      serialConnected: false,
      catalogRunning: false,
      selectedCloud,
      effectiveTarget: { siteId: null, deviceId: null },
      getBlockingConsoleTask: () => null,
    })).toEqual({
      available: false,
      reason: 'Serial session is not connected.',
    });
  });

  it('blocks cloud-required checks when no cloud is selected', () => {
    expect(getCatalogCheckAvailability('route-to-mist', {
      serialConnected: true,
      catalogRunning: false,
      selectedCloud: null,
      effectiveTarget: { siteId: null, deviceId: null },
      getBlockingConsoleTask: () => null,
    }).reason).toBe('Select a Mist cloud region first.');
  });

  it('blocks Mist-required checks when there is no matched site/device', () => {
    expect(getCatalogCheckAvailability('mist-last-seen', {
      serialConnected: true,
      catalogRunning: false,
      selectedCloud,
      effectiveTarget: { siteId: null, deviceId: null },
      getBlockingConsoleTask: () => null,
    }).reason).toBe('Identify and match the switch in Mist first.');
  });

  it('allows runnable checks when prerequisites are met', () => {
    expect(getCatalogCheckAvailability('mist-last-seen', {
      serialConnected: true,
      catalogRunning: false,
      selectedCloud,
      effectiveTarget: { siteId: 'site-1', deviceId: 'dev-1' },
      getBlockingConsoleTask: () => null,
    })).toEqual({ available: true, reason: null });
  });

  it('computes full baseline availability from shared runtime inputs', () => {
    expect(canRunFullBaseline({
      serialConnected: true,
      catalogRunning: false,
      selectedCloud,
      getBlockingConsoleTask: () => null,
    })).toBe(true);

    expect(canRunFullBaseline({
      serialConnected: true,
      catalogRunning: false,
      selectedCloud,
      getBlockingConsoleTask: () => ({ kind: 'user', label: 'catalog check' }),
    })).toBe(false);
  });

  it('builds run options when prerequisites are satisfied', () => {
    const result = resolveCatalogRunOptions(['lldp', 'route-to-mist'], {
      selectedCloud,
      effectiveTarget: { siteId: 'site-1', deviceId: 'dev-1' },
      uplinkPort: 'ge-0/0/0',
      onProgress: 'progress-callback',
    });

    expect('options' in result && result.options).toMatchObject({
      cloud: selectedCloud,
      uplinkPort: 'ge-0/0/0',
      siteId: 'site-1',
      deviceId: 'dev-1',
      checkIds: ['lldp', 'route-to-mist'],
      onProgress: 'progress-callback',
    });
  });

  it('returns a check-specific error when a Mist-dependent run lacks a match', () => {
    expect(resolveCatalogRunOptions(['mist-last-seen'], {
      selectedCloud,
      effectiveTarget: { siteId: null, deviceId: null },
      uplinkPort: '',
      onProgress: 'progress-callback',
    })).toEqual({
      error: 'Offline Timeline requires the switch to be identified and matched in Mist first.',
    });
  });
});
