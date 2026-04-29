import type { TroubleshootContext } from '@marvis/shared';
import type { CliExecutor } from '../runner.js';

export default async function resolveMcdLogFile(
  cli: CliExecutor,
  _ctx: TroubleshootContext,
): Promise<Partial<TroubleshootContext>> {
  // Junos 21.1+ renamed jmd.log → mist.log; check which file actually exists.
  const logList = await cli.run('show log | match "jmd\\|mist"').catch(() => '');

  if (/\bmist\.log\b/.test(logList)) return { mcdLogFile: 'mist.log' };
  if (/\bjmd\.log\b/.test(logList)) return { mcdLogFile: 'jmd.log' };

  // Fall back to version-based heuristic.
  const ver = await cli.run('show version | match Junos').catch(() => '');
  const majorMatch = ver.match(/Junos:\s*(\d+)/i);
  const major = majorMatch ? parseInt(majorMatch[1]!, 10) : 0;
  return { mcdLogFile: major >= 21 ? 'mist.log' : 'jmd.log' };
}
