import { describe, it, expect } from 'vitest';
import { MIST_CLOUDS, cloudFromCookieDomain, cloudConfig } from '../config/mist-clouds.js';

describe('MIST_CLOUDS', () => {
  it('has exactly 9 entries', () => {
    expect(MIST_CLOUDS).toHaveLength(9);
  });

  it('has unique cloud IDs', () => {
    const ids = MIST_CLOUDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique cookie domains', () => {
    const domains = MIST_CLOUDS.map((c) => c.cookieDomain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('all apiBase URLs use HTTPS', () => {
    for (const cloud of MIST_CLOUDS) {
      expect(cloud.apiBase).toMatch(/^https:\/\//);
    }
  });

  it('all labels are non-empty strings', () => {
    for (const cloud of MIST_CLOUDS) {
      expect(cloud.label.length).toBeGreaterThan(0);
    }
  });
});

describe('cloudFromCookieDomain', () => {
  it('returns global01 for mist.com', () => {
    expect(cloudFromCookieDomain('mist.com')).toBe('global01');
  });

  it('returns global01 for subdomain api.mist.com', () => {
    expect(cloudFromCookieDomain('api.mist.com')).toBe('global01');
  });

  it('returns emea01 for eu.mist.com', () => {
    expect(cloudFromCookieDomain('eu.mist.com')).toBe('emea01');
  });

  it('returns apac01 for ac5.mist.com', () => {
    expect(cloudFromCookieDomain('ac5.mist.com')).toBe('apac01');
  });

  it('returns us-gov-1 for us.mist-federal.com', () => {
    expect(cloudFromCookieDomain('us.mist-federal.com')).toBe('us-gov-1');
  });

  it('returns us-gov-2 for us2.mist-federal.com', () => {
    expect(cloudFromCookieDomain('us2.mist-federal.com')).toBe('us-gov-2');
  });

  it('returns undefined for unknown domain', () => {
    expect(cloudFromCookieDomain('example.com')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(cloudFromCookieDomain('')).toBeUndefined();
  });

  it('resolves every cloud from its own cookieDomain', () => {
    for (const cloud of MIST_CLOUDS) {
      expect(cloudFromCookieDomain(cloud.cookieDomain)).toBe(cloud.id);
    }
  });
});

describe('cloudConfig', () => {
  it('returns config for global01', () => {
    const cfg = cloudConfig('global01');
    expect(cfg.id).toBe('global01');
    expect(cfg.apiBase).toBe('https://api.mist.com');
  });

  it('returns config for emea01', () => {
    const cfg = cloudConfig('emea01');
    expect(cfg.id).toBe('emea01');
    expect(cfg.apiBase).toContain('eu.mist.com');
  });

  it('throws for unknown cloud ID', () => {
    expect(() => cloudConfig('nonexistent' as never)).toThrow(/Unknown Mist cloud/);
  });

  it('returned config is the same object as in MIST_CLOUDS', () => {
    const cfg = cloudConfig('global02');
    const direct = MIST_CLOUDS.find((c) => c.id === 'global02');
    expect(cfg).toBe(direct);
  });
});
