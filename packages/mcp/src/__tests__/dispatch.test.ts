import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { dispatchTool } from '../index.js';

function apiOk(data: unknown) {
  return Promise.resolve({
    json: () => Promise.resolve({ success: true, data }),
  });
}

function apiError(message: string) {
  return Promise.resolve({
    json: () => Promise.resolve({ success: false, error: message }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('list_sessions', () => {
  it('returns JSON of sessions array', async () => {
    mockFetch.mockReturnValueOnce(apiOk([{ sessionId: 'sess-1', deviceMac: 'aa:bb:cc:00:00:01' }]));
    const result = await dispatchTool('list_sessions', {});
    expect(result).toContain('sess-1');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/sessions'));
  });
});

describe('get_session', () => {
  it('returns JSON of session state', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', hasMistSession: false }));
    const result = await dispatchTool('get_session', { sessionId: 'sess-1' });
    expect(result).toContain('sess-1');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/sessions/sess-1/state'));
  });
});

describe('run_all_checks', () => {
  it('formats check results as status lines', async () => {
    mockFetch.mockReturnValueOnce(apiOk([
      { checkId: 'ntp-sync', status: 'pass', summary: 'NTP ok' },
      { checkId: 'jma-state', status: 'fail', summary: 'no JMA' },
    ]));
    const result = await dispatchTool('run_all_checks', { sessionId: 'sess-1' });
    expect(result).toContain('[PASS ]');
    expect(result).toContain('ntp-sync');
    expect(result).toContain('[FAIL ]');
    expect(result).toContain('jma-state');
  });
});

describe('run_check', () => {
  it('returns JSON of single check result', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ checkId: 'ntp-sync', status: 'pass', summary: 'ok' }));
    const result = await dispatchTool('run_check', { sessionId: 'sess-1', checkId: 'ntp-sync' });
    expect(result).toContain('ntp-sync');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sessions/sess-1/checks/ntp-sync/run'),
      expect.anything(),
    );
  });
});

describe('list_checks', () => {
  it('returns each check on its own line with group', async () => {
    const result = await dispatchTool('list_checks', {});
    expect(result.split('\n').length).toBeGreaterThan(1);
    expect(result).toContain('(');
  });
});

describe('read_output', () => {
  it('returns terminal output string', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', output: 'Juniper output here' }));
    const result = await dispatchTool('read_output', { sessionId: 'sess-1' });
    expect(result).toBe('Juniper output here');
  });

  it('returns placeholder when output is empty', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', output: '' }));
    const result = await dispatchTool('read_output', { sessionId: 'sess-1' });
    expect(result).toContain('no output');
  });

  it('appends chars param to URL when provided', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', output: 'x' }));
    await dispatchTool('read_output', { sessionId: 'sess-1', chars: '500' });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('chars=500'));
  });
});

describe('send_command', () => {
  it('returns command output string', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', command: 'show version', output: 'Junos 22.1' }));
    const result = await dispatchTool('send_command', { sessionId: 'sess-1', command: 'show version' });
    expect(result).toBe('Junos 22.1');
  });

  it('returns placeholder when output is empty', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', command: 'show version', output: '' }));
    const result = await dispatchTool('send_command', { sessionId: 'sess-1', command: 'show version' });
    expect(result).toContain('no output');
  });

  it('forwards optional timeoutMs as a number', async () => {
    mockFetch.mockReturnValueOnce(apiOk({ sessionId: 'sess-1', command: 'show version', output: 'x' }));
    await dispatchTool('send_command', { sessionId: 'sess-1', command: 'show version', timeoutMs: '5000' });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.timeoutMs).toBe(5000);
  });
});

describe('unknown tool', () => {
  it('throws for unrecognised tool name', async () => {
    await expect(dispatchTool('nonexistent', {})).rejects.toThrow('Unknown tool');
  });
});

describe('API error propagation', () => {
  it('throws when API returns success: false', async () => {
    mockFetch.mockReturnValueOnce(apiError('Session not found'));
    await expect(dispatchTool('get_session', { sessionId: 'bad' })).rejects.toThrow('Session not found');
  });
});
