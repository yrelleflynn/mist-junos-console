import type { Check, CheckContext, CheckResult } from './base';

function parseJunosVersionResult(output: string, id: string, name: string): CheckResult {
  const m = output.match(/(\d{2})\.(\d+)[A-Z](\d+)/i);
  if (!m) {
    return { id, name, status: 'warn', detail: 'Could not parse Junos version from output', raw: output };
  }

  const major = parseInt(m[1]);
  const minor = parseInt(m[2]);
  const release = parseInt(m[3]);

  const fullMatch = output.match(/(\d+\.\d+[A-Z]\d+[\w.-]*)/i);
  const displayVersion = fullMatch ? fullMatch[1] : `${major}.${minor}R${release}`;

  const meetsMinimum =
    major > 18 ||
    (major === 18 && minor > 2) ||
    (major === 18 && minor === 2 && release >= 3);

  const meetsRecommended = major > 20 || (major === 20 && minor >= 4);

  if (!meetsMinimum) {
    return {
      id, name, status: 'fail',
      detail: `Junos ${displayVersion} — below minimum supported version (18.2R3). Mist Agent requires Junos 18.2R3 or later.`,
      raw: output,
    };
  }

  if (!meetsRecommended) {
    return {
      id, name, status: 'warn',
      detail: `Junos ${displayVersion} — supported but upgrade to 20.4 or later is recommended for full Mist feature support.`,
      raw: output,
    };
  }

  return { id, name, status: 'pass', detail: `Junos ${displayVersion}`, raw: output };
}

export const junosVersionCheck: Check = {
  id: 'junos-version',
  name: 'Junos Version',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'junos-version';
    const name = 'Junos Version';

    let output = '';
    const targeted = await runner.execute('show version | match "Junos:"', 15000);
    if (targeted.success && targeted.output.trim().length > 0) {
      output = targeted.output;
    } else {
      const full = await runner.execute('show version', 15000);
      if (!full.success) {
        return { id, name, status: 'warn', detail: 'Could not determine Junos version', raw: full.output };
      }
      output = full.output;
    }

    return parseJunosVersionResult(output, id, name);
  },

  remediation(result) {
    const isBelowMin = result.status === 'fail';
    const isBelow20 = result.status === 'warn';
    if (isBelowMin) {
      return {
        text: 'This Junos version is below the minimum required for Mist Agent support (18.2R3).\n\n1. Download a supported Junos image (18.2R3 or later) from support.juniper.net\n2. Copy the image to the switch:\n   request system software add <package-path>\n3. Reboot to complete the upgrade:\n   request system reboot',
      };
    }
    if (isBelow20) {
      return {
        text: 'Upgrade to Junos 20.4 or later is recommended for full Mist feature support and current security patches.\n\n1. Download a Junos 20.4+ image from support.juniper.net\n2. Copy the image to the switch:\n   request system software add <package-path>\n3. Reboot to complete the upgrade:\n   request system reboot',
      };
    }
    return {};
  },
};
