import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MistContextController } from '../src/controllers/mist-context.controller';
import type { MistContextCallbacks } from '../src/controllers/mist-context.controller';
import { MIST_CLOUDS } from '../src/config/mist-clouds.config';
import type { MistSite } from '../src/services/mist-api.service';

const GLOBAL01 = MIST_CLOUDS.find((c) => c.id === 'global01')!;
const EMEA01 = MIST_CLOUDS.find((c) => c.id === 'emea01')!;

function createApiStub(sites: MistSite[] = []) {
  return {
    configure: vi.fn(),
    listSites: vi.fn().mockResolvedValue(sites),
  };
}

function createCallbacks() {
  return {
    onStatusChange: vi.fn(),
    onSitesLoaded: vi.fn(),
    onLoadingChange: vi.fn(),
  };
}

describe('MistContextController', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let api: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callbacks: any;
  let controller: MistContextController;

  beforeEach(() => {
    api = createApiStub();
    callbacks = createCallbacks();
    controller = new MistContextController(api as never, callbacks);
  });

  // ---- initial state ----

  it('starts unconfigured with empty state', () => {
    expect(controller.isConfigured).toBe(false);
    expect(controller.siteId).toBe('');
    expect(controller.state.cloud).toBeNull();
    expect(controller.state.orgId).toBe('');
    expect(controller.state.sites).toEqual([]);
  });

  // ---- save() ----

  it('save() returns false and fires onStatusChange(error) when token is empty', () => {
    const saved = controller.save('', 'api.mist.com', 'org-1', GLOBAL01);
    expect(saved).toBe(false);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(
      expect.stringContaining('Fill'),
      'error',
    );
    expect(controller.isConfigured).toBe(false);
  });

  it('save() returns false and fires onStatusChange(error) when orgId is empty', () => {
    const saved = controller.save('token-abc', 'api.mist.com', '', GLOBAL01);
    expect(saved).toBe(false);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(controller.isConfigured).toBe(false);
  });

  it('save() returns false and fires onStatusChange(error) when cloud is null', () => {
    const saved = controller.save('token-abc', 'api.mist.com', 'org-1', null);
    expect(saved).toBe(false);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(controller.isConfigured).toBe(false);
  });

  it('save() returns true, calls api.configure, and marks state as configured', () => {
    const saved = controller.save('token-abc', GLOBAL01.apiHost, 'org-1', GLOBAL01);
    expect(saved).toBe(true);
    expect(api.configure).toHaveBeenCalledWith('token-abc', GLOBAL01.apiHost, 'org-1');
    expect(controller.isConfigured).toBe(true);
    expect(controller.state.cloud).toBe(GLOBAL01);
    expect(controller.state.orgId).toBe('org-1');
  });

  it('save() fires onStatusChange(success) on success', () => {
    controller.save('token-abc', GLOBAL01.apiHost, 'org-1', GLOBAL01);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  // ---- loadSites() ----

  it('loadSites() fires onStatusChange(error) when token is empty', async () => {
    await controller.loadSites('', 'org-1', 'global01');
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(api.listSites).not.toHaveBeenCalled();
  });

  it('loadSites() fires onStatusChange(error) when orgId is empty', async () => {
    await controller.loadSites('token-abc', '', 'global01');
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(api.listSites).not.toHaveBeenCalled();
  });

  it('loadSites() fires onStatusChange(error) when cloudId is unknown', async () => {
    await controller.loadSites('token-abc', 'org-1', 'not-a-cloud');
    expect(callbacks.onStatusChange).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(api.listSites).not.toHaveBeenCalled();
  });

  it('loadSites() calls api.configure, fires onLoadingChange(true/false), and fires onSitesLoaded', async () => {
    const sites: MistSite[] = [{ id: 'site-1', name: 'HQ' }];
    api.listSites.mockResolvedValue(sites);

    await controller.loadSites('token-abc', 'org-1', 'global01');

    expect(api.configure).toHaveBeenCalledWith('token-abc', GLOBAL01.apiHost, 'org-1');
    expect(callbacks.onLoadingChange).toHaveBeenNthCalledWith(1, true);
    expect(callbacks.onLoadingChange).toHaveBeenNthCalledWith(2, false);
    expect(callbacks.onSitesLoaded).toHaveBeenCalledWith(sites);
    expect(controller.state.sites).toEqual(sites);
  });

  it('loadSites() fires onStatusChange(success) when sites are returned', async () => {
    const sites: MistSite[] = [
      { id: 'site-1', name: 'HQ' },
      { id: 'site-2', name: 'Branch' },
    ];
    api.listSites.mockResolvedValue(sites);

    await controller.loadSites('token-abc', 'org-1', 'global01');

    const [, type] = callbacks.onStatusChange.mock.calls[callbacks.onStatusChange.mock.calls.length - 1];
    expect(type).toBe('success');
  });

  it('loadSites() fires onStatusChange(error) when site list is empty', async () => {
    api.listSites.mockResolvedValue([]);

    await controller.loadSites('token-abc', 'org-1', 'global01');

    expect(callbacks.onSitesLoaded).toHaveBeenCalledWith([]);
    const [, type] = callbacks.onStatusChange.mock.calls[callbacks.onStatusChange.mock.calls.length - 1];
    expect(type).toBe('error');
  });

  it('loadSites() fires onStatusChange(error) and clears loading when api throws', async () => {
    api.listSites.mockRejectedValue(new Error('Network error'));

    await controller.loadSites('token-abc', 'org-1', 'global01');

    const statusCalls = callbacks.onStatusChange.mock.calls;
    const [msg, type] = statusCalls[statusCalls.length - 1];
    expect(type).toBe('error');
    expect(msg).toContain('Network error');
    expect(callbacks.onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it('loadSites() uses the correct cloud API host for non-global01 clouds', async () => {
    api.listSites.mockResolvedValue([{ id: 'site-eu', name: 'EU HQ' }]);

    await controller.loadSites('token-abc', 'org-eu', 'emea01');

    expect(api.configure).toHaveBeenCalledWith('token-abc', EMEA01.apiHost, 'org-eu');
  });

  // ---- selectSite() ----

  it('selectSite() updates the siteId in state', () => {
    controller.selectSite('site-42');
    expect(controller.siteId).toBe('site-42');
  });

  it('selectSite() can be updated multiple times', () => {
    controller.selectSite('site-1');
    controller.selectSite('site-2');
    expect(controller.siteId).toBe('site-2');
  });

  // ---- state snapshot isolation ----

  it('state getter returns a snapshot, not the internal reference', () => {
    const snap1 = controller.state;
    controller.selectSite('site-x');
    expect(snap1.siteId).toBe('');
  });
});
