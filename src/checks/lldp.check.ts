import type { Check, CheckContext, CheckResult } from './base';
import type { LldpNeighbor } from '../services/troubleshoot.service';

export interface LldpCheckResult {
  result: CheckResult;
  detectedPort: string | null;
  uplinkNeighbor: LldpNeighbor | null;
  needsUpstreamSelection?: boolean;
  [key: string]: unknown;
}

export const lldpCheck: Check = {
  id: 'lldp',
  name: 'LLDP Neighbors',

  async run({ runner, uplinkPort: userPort = '' }: CheckContext): Promise<LldpCheckResult> {
    const id = 'lldp';
    const name = 'LLDP Neighbors';

    const cmd = await runner.execute('show lldp neighbors', 20000, 3000);
    if (!cmd.success) {
      return {
        result: { id, name, status: 'fail', detail: cmd.error || 'Command failed', raw: cmd.output },
        detectedPort: null,
        uplinkNeighbor: null,
      };
    }

    const lines = cmd.output.split('\n').filter((l) => l.trim().length > 0);

    const headerLine = lines.find((l) => /Local Interface/i.test(l));
    let colPositions = { localIf: 0, parentIf: 0, chassisId: 0, portInfo: 0, systemName: 0 };

    if (headerLine) {
      colPositions = {
        localIf: headerLine.indexOf('Local Interface'),
        parentIf: headerLine.indexOf('Parent Interface'),
        chassisId: headerLine.indexOf('Chassis Id'),
        portInfo: headerLine.indexOf('Port info'),
        systemName: headerLine.indexOf('System Name'),
      };
    }

    const neighborLines = lines.filter((l) => /^(ge-|xe-|et-|mge-)/.test(l.trim()));

    if (neighborLines.length === 0) {
      return {
        result: { id, name, status: 'fail', detail: 'No LLDP neighbors found', raw: cmd.output },
        detectedPort: null,
        uplinkNeighbor: null,
        needsUpstreamSelection: true,
      };
    }

    const parseLine = (line: string): LldpNeighbor => {
      if (colPositions.systemName > 0) {
        return {
          localInterface: line.substring(colPositions.localIf, colPositions.parentIf).trim(),
          parentInterface: line.substring(colPositions.parentIf, colPositions.chassisId).trim(),
          chassisId: line.substring(colPositions.chassisId, colPositions.portInfo).trim(),
          portInfo: line.substring(colPositions.portInfo, colPositions.systemName).trim(),
          systemName: line.substring(colPositions.systemName).trim(),
        };
      }
      const parts = line.trim().split(/\s{2,}/);
      return {
        localInterface: parts[0] || '',
        parentInterface: parts[1] || '',
        chassisId: parts[2] || '',
        portInfo: parts[3] || '',
        systemName: parts[4] || '',
      };
    };

    const neighbors = neighborLines.map(parseLine);

    let uplinkNeighbor: LldpNeighbor | null = null;
    let detectedPort: string | null = null;

    if (userPort) {
      uplinkNeighbor = neighbors.find((n) => n.localInterface === userPort) || neighbors[0];
      detectedPort = userPort;
    } else {
      uplinkNeighbor = neighbors[0];
      detectedPort = uplinkNeighbor.localInterface || null;
    }

    const count = neighbors.length;
    let detail = `${count} neighbor(s). Uplink: ${detectedPort || 'none'}`;
    if (uplinkNeighbor) {
      detail += ` → ${uplinkNeighbor.systemName || 'unknown'} (${uplinkNeighbor.portInfo || 'unknown port'})`;
    }

    return {
      result: { id, name, status: 'pass', detail, raw: cmd.output },
      detectedPort,
      uplinkNeighbor,
    };
  },

  remediation() {
    return {
      text: '1. Verify the uplink cable is securely connected.\n2. Check upstream device has LLDP enabled.\n3. Try a different cable or SFP.\n4. Manually specify the uplink port if LLDP is disabled upstream.',
      commands: ['set protocols lldp interface all'],
    };
  },
};
