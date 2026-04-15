/**
 * Tests for the LLDP neighbor parser helpers in
 * src/services/troubleshoot/parsers/lldp.parser.ts
 *
 * All tests operate on static fixture strings — no serial I/O, no Mist API.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLldpColumnPositions,
  parseLldpNeighborLine,
  parseLldpNeighborsOutput,
  selectUplinkNeighbor,
} from '../src/services/troubleshoot/parsers/lldp.parser';
import * as F from './fixtures/lldp-neighbors';

// ---------------------------------------------------------------------------
// detectLldpColumnPositions
// ---------------------------------------------------------------------------

describe('detectLldpColumnPositions', () => {
  it('extracts correct positions from a standard header line', () => {
    const header = 'Local Interface    Parent Interface  Chassis Id         Port info          System Name';
    const pos = detectLldpColumnPositions(header);
    expect(pos.localIf).toBe(0);
    expect(pos.parentIf).toBeGreaterThan(0);
    expect(pos.chassisId).toBeGreaterThan(pos.parentIf);
    expect(pos.portInfo).toBeGreaterThan(pos.chassisId);
    expect(pos.systemName).toBeGreaterThan(pos.portInfo);
  });

  it('returns zero positions for a non-header line', () => {
    const pos = detectLldpColumnPositions('ge-0/0/0.0   -   44:f4:77:12:34:56   ge-0/1/5   core-sw-01');
    expect(pos.systemName).toBe(0);
  });

  it('returns zero positions for an empty string', () => {
    const pos = detectLldpColumnPositions('');
    expect(pos.localIf).toBe(0);
    expect(pos.systemName).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseLldpNeighborLine — column-based path
// ---------------------------------------------------------------------------

describe('parseLldpNeighborLine (column-based)', () => {
  const header = 'Local Interface    Parent Interface  Chassis Id         Port info          System Name';
  const colPos = detectLldpColumnPositions(header);

  it('parses a standard neighbor row correctly', () => {
    const line = 'ge-0/0/0.0         -                 44:f4:77:12:34:56  ge-0/1/5           core-sw-01';
    const n = parseLldpNeighborLine(line, colPos);
    expect(n.localInterface).toBe('ge-0/0/0.0');
    expect(n.chassisId).toBe('44:f4:77:12:34:56');
    expect(n.portInfo).toBe('ge-0/1/5');
    expect(n.systemName).toBe('core-sw-01');
  });

  it('handles an xe- interface prefix', () => {
    const line = 'xe-0/0/0.0         -                 2c:21:72:ab:cd:ef  Trunk_uplink       dist-sw-02';
    const n = parseLldpNeighborLine(line, colPos);
    expect(n.localInterface).toBe('xe-0/0/0.0');
    expect(n.portInfo).toBe('Trunk_uplink');
    expect(n.systemName).toBe('dist-sw-02');
  });
});

// ---------------------------------------------------------------------------
// parseLldpNeighborLine — fallback whitespace-split path
// ---------------------------------------------------------------------------

describe('parseLldpNeighborLine (fallback whitespace split)', () => {
  const zeroPos = { localIf: 0, parentIf: 0, chassisId: 0, portInfo: 0, systemName: 0 };

  it('splits on 2+ spaces when systemName position is 0', () => {
    const line = 'ge-0/0/0.0         -                 44:f4:77:12:34:56  ge-0/1/5           core-sw-01';
    const n = parseLldpNeighborLine(line, zeroPos);
    expect(n.localInterface).toBe('ge-0/0/0.0');
    // Remaining fields are split-based — we just assert they're non-empty strings
    expect(typeof n.chassisId).toBe('string');
    expect(typeof n.systemName).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// parseLldpNeighborsOutput — full output parsing
// ---------------------------------------------------------------------------

describe('parseLldpNeighborsOutput', () => {
  it('parses a single neighbor correctly', () => {
    const { neighbors } = parseLldpNeighborsOutput(F.LLDP_SINGLE_NEIGHBOR);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].localInterface).toBe('ge-0/0/0.0');
    expect(neighbors[0].chassisId).toBe('44:f4:77:12:34:56');
    expect(neighbors[0].systemName).toBe('core-sw-01');
  });

  it('parses two neighbors', () => {
    const { neighbors } = parseLldpNeighborsOutput(F.LLDP_TWO_NEIGHBORS);
    expect(neighbors).toHaveLength(2);
    expect(neighbors[0].localInterface).toBe('ge-0/0/0.0');
    expect(neighbors[1].localInterface).toBe('ge-0/0/1.0');
  });

  it('parses a neighbor with a Mist alias in port info', () => {
    const { neighbors } = parseLldpNeighborsOutput(F.LLDP_MIST_ALIAS_PORT);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].portInfo).toBe('Trunk_uplink');
  });

  it('returns an empty neighbors array for an empty table', () => {
    const { neighbors } = parseLldpNeighborsOutput(F.LLDP_EMPTY);
    expect(neighbors).toHaveLength(0);
  });

  it('falls back gracefully when there is no header line', () => {
    const { neighbors } = parseLldpNeighborsOutput(F.LLDP_NO_HEADER);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].localInterface).toBe('ge-0/0/0.0');
  });

  it('returns non-zero column positions when header is present', () => {
    const { colPositions } = parseLldpNeighborsOutput(F.LLDP_SINGLE_NEIGHBOR);
    expect(colPositions.systemName).toBeGreaterThan(0);
  });

  it('returns zero column positions when no header is present', () => {
    const { colPositions } = parseLldpNeighborsOutput(F.LLDP_NO_HEADER);
    expect(colPositions.systemName).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectUplinkNeighbor
// ---------------------------------------------------------------------------

describe('selectUplinkNeighbor', () => {
  const { neighbors } = parseLldpNeighborsOutput(F.LLDP_TWO_NEIGHBORS);

  it('returns the first neighbor when no user port is specified', () => {
    const { neighbor, detectedPort } = selectUplinkNeighbor(neighbors, '');
    expect(neighbor?.localInterface).toBe('ge-0/0/0.0');
    expect(detectedPort).toBe('ge-0/0/0.0');
  });

  it('returns the matching neighbor when user port is specified', () => {
    const { neighbor, detectedPort } = selectUplinkNeighbor(neighbors, 'ge-0/0/1.0');
    expect(neighbor?.localInterface).toBe('ge-0/0/1.0');
    expect(detectedPort).toBe('ge-0/0/1.0');
  });

  it('falls back to first neighbor when user port has no exact match', () => {
    const { neighbor, detectedPort } = selectUplinkNeighbor(neighbors, 'ge-0/0/9.0');
    // No match → falls back to first
    expect(neighbor?.localInterface).toBe('ge-0/0/0.0');
    expect(detectedPort).toBe('ge-0/0/9.0');
  });

  it('returns null neighbor and null port for empty list', () => {
    const { neighbor, detectedPort } = selectUplinkNeighbor([], 'ge-0/0/0.0');
    expect(neighbor).toBeNull();
    expect(detectedPort).toBeNull();
  });
});
