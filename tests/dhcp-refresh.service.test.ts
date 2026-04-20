import { describe, expect, it } from 'vitest';
import {
  DhcpRefreshService,
  buildChanges,
  ifaceToJunosPath,
  type DhcpBinding,
} from '../src/services/dhcp-refresh.service';

// ---- Sample Junos output from show dhcp client binding -------------------

const SUMMARY_OUTPUT = `
IP address        Hardware address   Expires     State      Interface
10.99.0.108       58:00:bb:b7:66:39  86260       BOUND      irb.0
0.0.0.0           58:00:bb:b7:66:3a  0           SELECTING  vme.0
`;

const SUMMARY_SINGLE_BOUND = `
IP address        Hardware address   Expires     State      Interface
10.99.0.108       58:00:bb:b7:66:39  86260       BOUND      irb.0
`;

const SUMMARY_INTERFACE_SECOND = `
IP address        Interface  Hardware address   Expires     State
10.99.0.108       irb.0      58:00:bb:b7:66:39  86260       BOUND
0.0.0.0           vme.0      58:00:bb:b7:66:3a  0           SELECTING
`;

const SUMMARY_EMPTY = `
IP address        Hardware address   Expires     State      Interface
`;

const DETAIL_OUTPUT = `

Client Interface/Id: irb.0
     Hardware Address:             58:00:bb:b7:66:39
     State:                        BOUND(LOCAL_CLIENT_STATE_BOUND)
     Lease Expires:                2026-04-19 11:13:12 UTC
     Lease Expires in:             86257 seconds
     Lease Start:                  2026-04-18 11:13:12 UTC
     Vendor Identifier             Juniper
     Server Identifier:            10.99.0.1
     Client IP Address:            10.99.0.108
     Update Server                 No

DHCP options:
    Name: dhcp-lease-time, Value: 1 day
    Name: server-identifier, Value: 10.99.0.1
    Name: router, Value: [ 10.99.0.1 ]
    Name: name-server, Value: [ 45.90.28.80, 45.90.30.80 ]
    Name: subnet-mask, Value: 255.255.255.0

Client Interface/Id: vme.0
     Hardware Address:             58:00:bb:b7:66:3a
     State:                        SELECTING(LOCAL_CLIENT_STATE_SELECTING)
     Vendor Identifier             Juniper
     Server Identifier:            0.0.0.0
     Client IP Address:            0.0.0.0
     Update Server                 No
`;

const DETAIL_AFTER_OUTPUT = `

Client Interface/Id: irb.0
     Hardware Address:             58:00:bb:b7:66:39
     State:                        BOUND(LOCAL_CLIENT_STATE_BOUND)
     Lease Expires:                2026-04-19 11:17:13 UTC
     Lease Expires in:             86376 seconds
     Lease Start:                  2026-04-18 11:17:13 UTC
     Vendor Identifier             Juniper
     Server Identifier:            10.99.0.1
     Client IP Address:            10.99.0.108
     Update Server                 No

Client Interface/Id: vme.0
     Hardware Address:             58:00:bb:b7:66:3a
     State:                        SELECTING(LOCAL_CLIENT_STATE_SELECTING)
     Vendor Identifier             Juniper
     Server Identifier:            0.0.0.0
     Client IP Address:            0.0.0.0
     Update Server                 No
`;

// ---- Helpers ---------------------------------------------------------------

function makeService() {
  // Runner stub — not needed for parser-only tests
  return new DhcpRefreshService({} as never);
}

function makeBinding(overrides: Partial<DhcpBinding> = {}): DhcpBinding {
  return {
    interface: 'irb.0',
    ipAddress: '10.99.0.108',
    hwAddress: '58:00:bb:b7:66:39',
    expiresSeconds: 86260,
    state: 'BOUND',
    serverIdentifier: '10.99.0.1',
    leaseStart: '2026-04-18 11:13:12 UTC',
    leaseExpires: '2026-04-19 11:13:12 UTC',
    dnsServers: [],
    ...overrides,
  };
}

// ---- parseSummary ----------------------------------------------------------

describe('DhcpRefreshService.parseSummary', () => {
  it('parses a BOUND and a SELECTING row', () => {
    const svc = makeService();
    const bindings = svc.parseSummary(SUMMARY_OUTPUT);

    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toMatchObject({
      ipAddress: '10.99.0.108',
      hwAddress: '58:00:bb:b7:66:39',
      expiresSeconds: 86260,
      state: 'BOUND',
      interface: 'irb.0',
    });
    expect(bindings[1]).toMatchObject({
      ipAddress: '0.0.0.0',
      state: 'SELECTING',
      interface: 'vme.0',
      expiresSeconds: 0,
    });
  });

  it('returns an empty array when no data rows are present', () => {
    const svc = makeService();
    expect(svc.parseSummary(SUMMARY_EMPTY)).toHaveLength(0);
    expect(svc.parseSummary('')).toHaveLength(0);
  });

  it('skips the header row without misinterpreting it', () => {
    const svc = makeService();
    const bindings = svc.parseSummary(SUMMARY_OUTPUT);
    expect(bindings.every((b) => /^\d+\.\d+/.test(b.ipAddress))).toBe(true);
  });

  it('parses bindings even when the interface column is not the last token', () => {
    const svc = makeService();
    const bindings = svc.parseSummary(SUMMARY_INTERFACE_SECOND);

    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toMatchObject({
      ipAddress: '10.99.0.108',
      interface: 'irb.0',
      hwAddress: '58:00:bb:b7:66:39',
      expiresSeconds: 86260,
      state: 'BOUND',
    });
    expect(bindings[1]).toMatchObject({
      interface: 'vme.0',
      hwAddress: '58:00:bb:b7:66:3a',
      state: 'SELECTING',
    });
  });
});

// ---- parseDetail -----------------------------------------------------------

describe('DhcpRefreshService.parseDetail', () => {
  it('extracts server identifier and lease times for each interface', () => {
    const svc = makeService();
    const map = svc.parseDetail(DETAIL_OUTPUT);

    expect(map.get('irb.0')).toMatchObject({
      serverIdentifier: '10.99.0.1',
      leaseStart: '2026-04-18 11:13:12 UTC',
      leaseExpires: '2026-04-19 11:13:12 UTC',
      dnsServers: ['45.90.28.80', '45.90.30.80'],
    });
  });

  it('returns null lease fields for SELECTING interfaces with no server', () => {
    const svc = makeService();
    const map = svc.parseDetail(DETAIL_OUTPUT);
    const vme = map.get('vme.0');

    expect(vme).toBeDefined();
    // Server identifier is "0.0.0.0" in the output
    expect(vme!.serverIdentifier).toBe('0.0.0.0');
    expect(vme!.leaseStart).toBeNull();
    expect(vme!.leaseExpires).toBeNull();
  });

  it('returns an empty map when output is empty', () => {
    const svc = makeService();
    expect(svc.parseDetail('').size).toBe(0);
  });
});

// ---- ifaceToJunosPath ------------------------------------------------------

describe('ifaceToJunosPath', () => {
  it('converts irb.0 to the correct Junos config path', () => {
    expect(ifaceToJunosPath('irb.0')).toBe('interfaces irb unit 0');
  });

  it('converts vme.0', () => {
    expect(ifaceToJunosPath('vme.0')).toBe('interfaces vme unit 0');
  });

  it('converts a physical interface unit', () => {
    expect(ifaceToJunosPath('ge-0/0/0.0')).toBe('interfaces ge-0/0/0 unit 0');
  });

  it('falls back gracefully for names without a dot', () => {
    expect(ifaceToJunosPath('irb')).toBe('interfaces irb unit 0');
  });
});

// ---- buildChanges ----------------------------------------------------------

describe('buildChanges', () => {
  it('classifies a successfully renewed binding', () => {
    const before = [makeBinding({ leaseStart: '2026-04-18 11:13:12 UTC' })];
    const after = [makeBinding({ leaseStart: '2026-04-18 11:17:13 UTC' })];

    const changes = buildChanges(['irb.0'], before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0].outcome).toBe('renewed');
  });

  it('classifies unchanged when lease start is identical', () => {
    const binding = makeBinding();
    const changes = buildChanges(['irb.0'], [binding], [{ ...binding }]);
    expect(changes[0].outcome).toBe('unchanged');
  });

  it('classifies no-response when still SELECTING after the cycle', () => {
    const before = [makeBinding({ interface: 'vme.0', ipAddress: '0.0.0.0', state: 'SELECTING', expiresSeconds: 0 })];
    const after = [makeBinding({ interface: 'vme.0', ipAddress: '0.0.0.0', state: 'SELECTING', expiresSeconds: 0 })];

    const changes = buildChanges(['vme.0'], before, after);
    expect(changes[0].outcome).toBe('no-response');
  });

  it('classifies acquired when a previously SELECTING interface becomes BOUND', () => {
    const before = [makeBinding({ state: 'SELECTING', ipAddress: '0.0.0.0', expiresSeconds: 0 })];
    const after = [makeBinding({ state: 'BOUND' })];

    const changes = buildChanges(['irb.0'], before, after);
    expect(changes[0].outcome).toBe('acquired');
  });

  it('classifies lost when an interface disappears from the after table', () => {
    const before = [makeBinding()];
    const changes = buildChanges(['irb.0'], before, []);
    expect(changes[0].outcome).toBe('lost');
  });

  it('reflects the real before/after detail from the provided Junos samples', () => {
    const svc = makeService();
    const beforeBindings = svc.parseSummary(SUMMARY_OUTPUT).map((b) => ({
      ...b,
      ...Object.fromEntries(
        [...svc.parseDetail(DETAIL_OUTPUT).entries()]
          .filter(([k]) => k === b.interface)
          .map(([, v]) => Object.entries(v))
          .flat(),
      ),
    })) as DhcpBinding[];

    const afterBindings = svc.parseSummary(SUMMARY_OUTPUT).map((b) => ({
      ...b,
      ...Object.fromEntries(
        [...svc.parseDetail(DETAIL_AFTER_OUTPUT).entries()]
          .filter(([k]) => k === b.interface)
          .map(([, v]) => Object.entries(v))
          .flat(),
      ),
    })) as DhcpBinding[];

    const changes = buildChanges(['irb.0', 'vme.0'], beforeBindings, afterBindings);

    const irb = changes.find((c) => c.interface === 'irb.0')!;
    const vme = changes.find((c) => c.interface === 'vme.0')!;

    expect(irb.outcome).toBe('renewed');    // Lease start changed
    expect(vme.outcome).toBe('no-response'); // Still SELECTING
  });
});
