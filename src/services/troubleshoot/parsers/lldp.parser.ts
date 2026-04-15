/**
 * lldp.parser.ts — Pure LLDP neighbor table parsing helpers
 *
 * Extracted from TroubleshootService so the parsing logic can be tested
 * independently of serial I/O or Mist API calls.
 *
 * Input: raw text output of `show lldp neighbors`
 * Output: structured LldpNeighbor objects
 */

/** A single LLDP neighbor row from `show lldp neighbors`. */
export interface LldpNeighbor {
  localInterface: string;
  parentInterface: string;
  chassisId: string;     // MAC address of the upstream switch
  portInfo: string;      // Port description/name on the upstream switch (Mist port alias)
  systemName: string;    // Hostname of the upstream switch
}

/** Column positions derived from the header line of `show lldp neighbors`. */
export interface LldpColumnPositions {
  localIf: number;
  parentIf: number;
  chassisId: number;
  portInfo: number;
  systemName: number;
}

/** Sentinel returned when the header line is not found. */
const EMPTY_COL_POSITIONS: LldpColumnPositions = {
  localIf: 0,
  parentIf: 0,
  chassisId: 0,
  portInfo: 0,
  systemName: 0,
};

/**
 * Detect column positions from the LLDP neighbor table header line.
 * Returns EMPTY_COL_POSITIONS if the line doesn't look like a header.
 */
export function detectLldpColumnPositions(headerLine: string): LldpColumnPositions {
  if (!headerLine || !/Local Interface/i.test(headerLine)) {
    return { ...EMPTY_COL_POSITIONS };
  }
  return {
    localIf: headerLine.indexOf('Local Interface'),
    parentIf: headerLine.indexOf('Parent Interface'),
    chassisId: headerLine.indexOf('Chassis Id'),
    portInfo: headerLine.indexOf('Port info'),
    systemName: headerLine.indexOf('System Name'),
  };
}

/**
 * Parse a single LLDP neighbor table row using the detected column positions.
 * Falls back to whitespace-splitting when column positions are unavailable
 * (i.e. when systemName position is 0, meaning no header was parsed).
 */
export function parseLldpNeighborLine(
  line: string,
  colPositions: LldpColumnPositions,
): LldpNeighbor {
  if (colPositions.systemName > 0) {
    return {
      localInterface: line.substring(colPositions.localIf, colPositions.parentIf).trim(),
      parentInterface: line.substring(colPositions.parentIf, colPositions.chassisId).trim(),
      chassisId: line.substring(colPositions.chassisId, colPositions.portInfo).trim(),
      portInfo: line.substring(colPositions.portInfo, colPositions.systemName).trim(),
      systemName: line.substring(colPositions.systemName).trim(),
    };
  }
  // Fallback: split by 2+ whitespace (less reliable for multi-word port info)
  const parts = line.trim().split(/\s{2,}/);
  return {
    localInterface: parts[0] || '',
    parentInterface: parts[1] || '',
    chassisId: parts[2] || '',
    portInfo: parts[3] || '',
    systemName: parts[4] || '',
  };
}

/**
 * Parse the full text output of `show lldp neighbors`.
 *
 * Neighbour interface lines are identified by the Junos naming convention
 * (ge-/xe-/et-/mge- prefix). The header line is used to establish column
 * positions for accurate field extraction.
 */
export function parseLldpNeighborsOutput(output: string): {
  colPositions: LldpColumnPositions;
  neighbors: LldpNeighbor[];
} {
  const lines = output.split('\n').filter((l) => l.trim().length > 0);

  const headerLine = lines.find((l) => /Local Interface/i.test(l));
  const colPositions = headerLine
    ? detectLldpColumnPositions(headerLine)
    : { ...EMPTY_COL_POSITIONS };

  const neighborLines = lines.filter((l) => /^(ge-|xe-|et-|mge-)/.test(l.trim()));
  const neighbors = neighborLines.map((l) => parseLldpNeighborLine(l, colPositions));

  return { colPositions, neighbors };
}

/**
 * Select the uplink neighbor from a list of parsed neighbors.
 *
 * If `userPort` is specified and matches a neighbor, that neighbor is used.
 * Otherwise the first neighbor in the list is treated as the uplink.
 * Returns null if the list is empty.
 */
export function selectUplinkNeighbor(
  neighbors: LldpNeighbor[],
  userPort: string,
): { neighbor: LldpNeighbor | null; detectedPort: string | null } {
  if (neighbors.length === 0) {
    return { neighbor: null, detectedPort: null };
  }
  if (userPort) {
    const match = neighbors.find((n) => n.localInterface === userPort);
    return {
      neighbor: match ?? neighbors[0],
      detectedPort: userPort,
    };
  }
  return {
    neighbor: neighbors[0],
    detectedPort: neighbors[0].localInterface || null,
  };
}
