import { describe, expect, it, vi } from 'vitest';

import {
  applyAdoptionPlan,
  buildAdoptionPreviewHtml,
  parseAdoptionCommands,
  prepareAdoptionPlan,
} from '../src/features/adoption/workflow';

describe('adoption workflow helpers', () => {
  it('parses adoption command lines and rejects empty responses', () => {
    expect(parseAdoptionCommands('set system host-name sw1\nset system services ssh\n')).toEqual([
      'set system host-name sw1',
      'set system services ssh',
    ]);

    expect(() => parseAdoptionCommands('{"cmd":"noop"}')).toThrow(
      'No adoption commands returned from API. The endpoint may not be available for your account.',
    );
  });

  it('prepares a plan with a Mist site root password when root auth is missing', async () => {
    const result = await prepareAdoptionPlan({
      getAdoptionCommands: vi.fn().mockResolvedValue('set system host-name sw1\n'),
      getSiteId: vi.fn().mockReturnValue('site-1'),
      getRootPassword: vi.fn().mockResolvedValue('mist-root'),
      getUserProvidedRootPassword: vi.fn().mockReturnValue(''),
      term: {
        writeSystem: vi.fn(),
      },
    });

    expect(result).toEqual({
      kind: 'ready',
      plan: {
        commandLines: ['set system host-name sw1'],
        hasRootAuth: true,
        rootPassword: 'mist-root',
        rootPasswordSource: 'mist-site',
        totalCommands: 1,
      },
    });
  });

  it('still prepares a plan when no root password is available yet', async () => {
    const result = await prepareAdoptionPlan({
      getAdoptionCommands: vi.fn().mockResolvedValue('set system host-name sw1\n'),
      getSiteId: vi.fn().mockReturnValue('site-1'),
      getRootPassword: vi.fn().mockResolvedValue(null),
      getUserProvidedRootPassword: vi.fn().mockReturnValue(''),
      term: {
        writeSystem: vi.fn(),
      },
    });

    expect(result).toEqual({
      kind: 'ready',
      plan: {
        commandLines: ['set system host-name sw1'],
        hasRootAuth: true,
        rootPassword: null,
        rootPasswordSource: null,
        totalCommands: 1,
      },
    });
  });

  it('builds preview HTML with a masked root-auth line when needed', () => {
    const html = buildAdoptionPreviewHtml({
      commandLines: ['set system host-name sw1'],
      hasRootAuth: false,
      rootPassword: 'mist-root',
      rootPasswordSource: 'mist-site',
      totalCommands: 2,
    }, (value) => value);

    expect(html).toContain('Adoption Commands');
    expect(html).toContain('2 total commands from Mist adoption intent.');
    expect(html).toContain('set system root-authentication plain-text-password');
    expect(html).toContain('btn-adopt-apply');
  });

  it('applies an adoption plan and commits successfully', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ success: true, output: 'root@switch# ' })
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({ success: true, output: 'commit complete' });
    const send = vi.fn().mockResolvedValue(undefined);
    const sendAndWaitFor = vi
      .fn()
      .mockResolvedValueOnce({ output: 'New password:', matched: true })
      .mockResolvedValueOnce({ output: 'root@switch# ', matched: true });
    const renderStatus = vi.fn();
    const term = {
      writeSystem: vi.fn(),
      writeError: vi.fn(),
    };

    const outcome = await applyAdoptionPlan({
      commandLines: ['set system host-name sw1'],
      hasRootAuth: false,
      rootPassword: 'mist-root',
      rootPasswordSource: 'mist-site',
      totalCommands: 2,
    }, {
      execute,
      send,
      sendAndWaitFor,
      wait: vi.fn().mockResolvedValue(undefined),
      term,
      renderStatus,
    });

    expect(outcome).toEqual({ kind: 'commit-success' });
    expect(send).toHaveBeenCalledWith('set system root-authentication plain-text-password\n');
    expect(execute).toHaveBeenNthCalledWith(1, 'edit', 5000);
    expect(execute).toHaveBeenNthCalledWith(2, 'set system host-name sw1', 5000, 500);
    expect(execute).toHaveBeenNthCalledWith(3, 'commit and-quit', 60000, 5000);
    expect(renderStatus).toHaveBeenLastCalledWith(expect.stringContaining('Adoption commands applied and committed successfully'));
  });
});
