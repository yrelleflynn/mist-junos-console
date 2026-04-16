import { afterEach, describe, expect, it, vi } from 'vitest';
import { MistApiService } from '../src/services/mist-api.service';

describe('MistApiService.getAccessibleOrgs', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('deduplicates orgs when /api/v1/self returns multiple privileges for the same org', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        privileges: [
          { scope: 'org', org_id: 'org-1', org_name: 'Alpha Org', role: 'admin' },
          { scope: 'org', org_id: 'org-1', org_name: 'Alpha Org', role: 'viewer' },
          { scope: 'org', org_id: 'org-2', org_name: 'Beta Org', role: 'admin' },
          { scope: 'site', org_id: 'org-3', org_name: 'Ignored Site Scope', role: 'admin' },
        ],
      }),
    }) as typeof fetch;

    const api = new MistApiService();
    const orgs = await api.getAccessibleOrgs('token-abc', 'api.mist.com');

    expect(orgs).toEqual([
      { id: 'org-1', name: 'Alpha Org' },
      { id: 'org-2', name: 'Beta Org' },
    ]);
  });

  it('falls back to org detail lookups when /api/v1/self does not include org names', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          privileges: [
            { scope: 'org', org_id: 'org-1', role: 'admin' },
            { scope: 'org', org_id: 'org-2', role: 'viewer' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'org-1', name: 'Alpha Org' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'org-2', name: 'Beta Org' }),
      }) as typeof fetch;

    const api = new MistApiService();
    const orgs = await api.getAccessibleOrgs('token-abc', 'api.mist.com');

    expect(orgs).toEqual([
      { id: 'org-1', name: 'Alpha Org' },
      { id: 'org-2', name: 'Beta Org' },
    ]);
  });

  it('prefers the privilege name field from /api/v1/self when it is present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        privileges: [
          { scope: 'org', org_id: 'org-1', name: 'Morrison', role: 'admin' },
        ],
      }),
    }) as typeof fetch;

    const api = new MistApiService();
    const orgs = await api.getAccessibleOrgs('token-abc', 'api.mist.com');

    expect(orgs).toEqual([{ id: 'org-1', name: 'Morrison' }]);
  });
});
