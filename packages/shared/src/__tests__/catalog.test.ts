import { describe, it, expect } from 'vitest';
import { CHECKS } from '../catalog/checks.js';
import { RESOLVERS } from '../catalog/resolvers.js';
import type { CheckId, GroupId } from '../types/check.js';
import type { TroubleshootContext } from '../catalog/troubleshoot-context.js';

const VALID_GROUP_IDS: GroupId[] = ['connectivity', 'routing', 'dns', 'mist-cloud', 'history'];

const CONTEXT_FIELDS = new Set<string>([
  'mistSession', 'deviceMatch',
  'uplinkPort', 'uplinkPortStatus', 'uplinkPortErrors',
  'managementIp', 'managementPrefix', 'managementVlan', 'defaultGateway',
  'dnsServers',
  'jmaState', 'mistEndpoint',
  'mcdLogFile', 'mcdLogLines',
  'offlineAt', 'mistLastSeen', 'mistEventsNearOffline',
] satisfies (keyof TroubleshootContext)[]);

describe('CHECKS catalog', () => {
  it('has exactly 21 entries', () => {
    expect(CHECKS).toHaveLength(21);
  });

  it('has no duplicate check IDs', () => {
    const ids = CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all checks have a valid groupId', () => {
    for (const check of CHECKS) {
      expect(VALID_GROUP_IDS).toContain(check.groupId);
    }
  });

  it('all checks have timeoutMs > 0', () => {
    for (const check of CHECKS) {
      expect(check.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('all gate references point to valid check IDs', () => {
    const ids = new Set(CHECKS.map((c) => c.id));
    for (const check of CHECKS) {
      for (const gate of check.gates ?? []) {
        expect(ids.has(gate as CheckId), `gate '${gate}' in '${check.id}' is not a valid check ID`).toBe(true);
      }
    }
  });

  it('all needs fields exist on TroubleshootContext', () => {
    for (const check of CHECKS) {
      for (const field of check.needs) {
        expect(CONTEXT_FIELDS.has(field), `needs '${field}' in '${check.id}' is not on TroubleshootContext`).toBe(true);
      }
    }
  });

  it('no check declares itself as a gate', () => {
    for (const check of CHECKS) {
      expect(check.gates ?? []).not.toContain(check.id);
    }
  });

  it('gate checks appear before their dependants in catalog order', () => {
    const indexById = new Map(CHECKS.map((c, i) => [c.id, i]));
    for (const check of CHECKS) {
      const checkIdx = indexById.get(check.id)!;
      for (const gate of check.gates ?? []) {
        const gateIdx = indexById.get(gate as CheckId)!;
        expect(gateIdx, `gate '${gate}' comes after '${check.id}' — forward dependency`).toBeLessThan(checkIdx);
      }
    }
  });
});

describe('RESOLVERS catalog', () => {
  it('has exactly 8 entries', () => {
    expect(RESOLVERS).toHaveLength(8);
  });

  it('has no duplicate resolver IDs', () => {
    const ids = RESOLVERS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all provides fields exist on TroubleshootContext', () => {
    for (const resolver of RESOLVERS) {
      for (const field of resolver.provides) {
        expect(CONTEXT_FIELDS.has(field), `provides '${field}' in resolver '${resolver.id}' not on TroubleshootContext`).toBe(true);
      }
    }
  });

  it('all needs fields exist on TroubleshootContext', () => {
    for (const resolver of RESOLVERS) {
      for (const field of resolver.needs ?? []) {
        expect(CONTEXT_FIELDS.has(field), `needs '${field}' in resolver '${resolver.id}' not on TroubleshootContext`).toBe(true);
      }
    }
  });
});
