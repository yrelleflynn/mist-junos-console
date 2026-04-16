import { describe, expect, it } from 'vitest';
import {
  JMA_CONNECTIVITY_STATE_MAP,
  parseJmaConnectivityState,
} from '../src/services/troubleshoot/parsers/jma-connectivity.parser';

const CONNECTED_OUTPUT = `
LLDP Local Information details

cc-state   cc-message                                                cc-errno
111        Agent connected to controller                             0
`;

const CLOUD_UNREACHABLE_OUTPUT = `
cc-state   cc-message                                                cc-errno
108        Cloud connection attempt failed                           17
`;

const CONNECTED_WITH_REFERENCE_OUTPUT = `
LLDP Local Information details

cc-state   cc-message                                                cc-errno
111        Agent connected to controller                             0

State Reference

[0] None
`;

describe('parseJmaConnectivityState', () => {
  it('parses a known connected state row', () => {
    const parsed = parseJmaConnectivityState(CONNECTED_OUTPUT);

    expect(parsed.code).toBe(111);
    expect(parsed.name).toBe('Connected');
    expect(parsed.label).toBe('111 Connected');
    expect(parsed.severity).toBe('pass');
    expect(parsed.message).toBe('Agent connected to controller');
    expect(parsed.errno).toBe(0);
  });

  it('parses rows using the whitespace fallback split', () => {
    const parsed = parseJmaConnectivityState(CLOUD_UNREACHABLE_OUTPUT);

    expect(parsed.code).toBe(108);
    expect(parsed.name).toBe('CloudUnreachable');
    expect(parsed.severity).toBe('fail');
    expect(parsed.message).toBe('Cloud connection attempt failed');
    expect(parsed.errno).toBe(17);
    expect(parsed.detail).toBe(JMA_CONNECTIVITY_STATE_MAP[108].detail);
  });

  it('prefers the numeric value row even when reference text follows later in the output', () => {
    const parsed = parseJmaConnectivityState(CONNECTED_WITH_REFERENCE_OUTPUT);

    expect(parsed.code).toBe(111);
    expect(parsed.message).toBe('Agent connected to controller');
    expect(parsed.errno).toBe(0);
  });

  it('returns an unknown state when the header row is missing', () => {
    const parsed = parseJmaConnectivityState('show lldp local-information failed');

    expect(parsed.code).toBeNull();
    expect(parsed.name).toBe('Unknown');
    expect(parsed.severity).toBe('unknown');
    expect(parsed.detail).toContain('Could not find');
  });

  it('returns an unknown state when the value row is missing', () => {
    const parsed = parseJmaConnectivityState('cc-state   cc-message   cc-errno\n');

    expect(parsed.code).toBeNull();
    expect(parsed.detail).toContain('no value row');
  });

  it('keeps unknown numeric states parseable with a generic label', () => {
    const parsed = parseJmaConnectivityState(
      'cc-state   cc-message                                                cc-errno\n999        Future state                                            4\n',
    );

    expect(parsed.code).toBe(999);
    expect(parsed.name).toBe('State999');
    expect(parsed.label).toBe('999 State999');
    expect(parsed.severity).toBe('info');
    expect(parsed.message).toBe('Future state');
    expect(parsed.errno).toBe(4);
  });
});
