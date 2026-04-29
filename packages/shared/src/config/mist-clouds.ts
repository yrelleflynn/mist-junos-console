import type { MistCloud } from '../types/session.js';

export interface MistCloudConfig {
  readonly id: MistCloud;
  readonly label: string;
  readonly apiBase: string;
  readonly cookieDomain: string;
}

export const MIST_CLOUDS: readonly MistCloudConfig[] = [
  {
    id: 'global01',
    label: 'Global 01',
    apiBase: 'https://api.mist.com',
    cookieDomain: 'mist.com',
  },
  {
    id: 'global02',
    label: 'Global 02',
    apiBase: 'https://api.gc1.mist.com',
    cookieDomain: 'gc1.mist.com',
  },
  {
    id: 'global03',
    label: 'Global 03',
    apiBase: 'https://api.ac2.mist.com',
    cookieDomain: 'ac2.mist.com',
  },
  {
    id: 'global04',
    label: 'Global 04',
    apiBase: 'https://api.gc2.mist.com',
    cookieDomain: 'gc2.mist.com',
  },
  {
    id: 'global05',
    label: 'Global 05',
    apiBase: 'https://api.gc3.mist.com',
    cookieDomain: 'gc3.mist.com',
  },
  {
    id: 'emea01',
    label: 'EMEA 01',
    apiBase: 'https://api.eu.mist.com',
    cookieDomain: 'eu.mist.com',
  },
  {
    id: 'apac01',
    label: 'APAC 01',
    apiBase: 'https://api.ac5.mist.com',
    cookieDomain: 'ac5.mist.com',
  },
  {
    id: 'us-gov-1',
    label: 'US Gov 1',
    apiBase: 'https://api.us.mist-federal.com',
    cookieDomain: 'us.mist-federal.com',
  },
  {
    id: 'us-gov-2',
    label: 'US Gov 2',
    apiBase: 'https://api.us2.mist-federal.com',
    cookieDomain: 'us2.mist-federal.com',
  },
] as const;

export function cloudFromCookieDomain(domain: string): MistCloud | undefined {
  const exact = MIST_CLOUDS.find((c) => c.cookieDomain === domain);
  if (exact) return exact.id;
  const sub = MIST_CLOUDS.find((c) => domain.endsWith('.' + c.cookieDomain));
  return sub?.id;
}

export function cloudConfig(cloud: MistCloud): MistCloudConfig {
  const entry = MIST_CLOUDS.find((c) => c.id === cloud);
  if (!entry) throw new Error(`Unknown Mist cloud: ${cloud}`);
  return entry;
}
