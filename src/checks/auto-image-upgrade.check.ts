import type { Check, CheckContext, CheckResult } from './base';

/**
 * Checks whether Junos Auto Image Upgrade is configured.
 * If it is, disables it automatically via configure + delete + commit.
 *
 * Auto Image Upgrade generates constant console noise (phone-home ZTP messages)
 * that corrupts command output during troubleshooting.
 */
export const autoImageUpgradeCheck: Check = {
  id: 'auto-image-upgrade',
  name: 'Auto Image Upgrade',

  async run({ runner }: CheckContext): Promise<CheckResult> {
    const id = 'auto-image-upgrade';
    const name = 'Auto Image Upgrade';

    // Check if auto-image-upgrade is present in the chassis config
    const checkCmd = await runner.execute(
      'show configuration chassis | match "auto-image-upgrade"',
      10000, 2000,
    );

    if (!checkCmd.success || !checkCmd.output.includes('auto-image-upgrade')) {
      return {
        id, name, status: 'pass',
        detail: 'Auto Image Upgrade not configured',
        raw: checkCmd.output,
      };
    }

    // Feature is configured — disable it to stop console noise
    await runner.execute('configure', 5000, 2000);
    await runner.execute('delete chassis auto-image-upgrade', 5000, 2000);
    const commitResult = await runner.execute('commit', 15000, 3000);
    await runner.execute('exit', 5000, 2000);

    const commitOk = /commit complete/i.test(commitResult.output);

    if (commitOk) {
      return {
        id, name, status: 'pass',
        detail: 'Auto Image Upgrade was enabled — deleted and committed. Console noise suppressed.',
        raw: commitResult.output,
      };
    }

    return {
      id, name, status: 'warn',
      detail: 'Auto Image Upgrade found and delete issued, but commit result unclear — check terminal',
      raw: commitResult.output,
    };
  },
};
