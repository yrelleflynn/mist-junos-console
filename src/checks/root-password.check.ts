import type { Check, CheckContext, CheckResult } from './base';

/**
 * Verifies that a root authentication password is configured on the switch.
 *
 * If no password is found:
 *   1. Tries to retrieve the site root password from the Mist API.
 *   2. Falls back to prompting the user for a password.
 *   3. Configures the password on the switch and commits.
 *
 * Junos requires an encrypted root password before it will commit any configuration.
 * Without it the switch cannot be properly managed or onboarded to Mist.
 * This check runs first — if it fails, all subsequent checks are skipped.
 */
export const rootPasswordCheck: Check = {
  id: 'root-password',
  name: 'Root Password',
  critical: true,

  async run(ctx: CheckContext): Promise<CheckResult> {
    const id = 'root-password';
    const name = 'Root Password';
    const { runner } = ctx;

    const cmd = await runner.execute(
      'show configuration system root-authentication',
      10000,
      2000,
    );

    if (!cmd.success) {
      return {
        id, name, status: 'fail',
        detail: 'Could not read root-authentication config',
        raw: cmd.output,
      };
    }

    if (cmd.output.includes('encrypted-password')) {
      return {
        id, name, status: 'pass',
        detail: 'Root password is configured',
        raw: cmd.output,
      };
    }

    // No root password set — try to obtain one and configure it
    let password: string | null = null;
    let source = '';

    // 1. Try Mist API
    if (ctx.mistApi?.isConfigured && ctx.siteId) {
      try {
        password = await ctx.mistApi.getRootPassword(ctx.siteId);
        if (password) source = 'Mist site password';
      } catch {
        // ignore — fall through to prompt
      }
    }

    // 2. Prompt the user
    if (!password && ctx.promptPassword) {
      const message = ctx.mistApi?.isConfigured
        ? 'No root password is configured on this switch, and none was found in Mist for this site. Enter a password to set:'
        : 'No root password is configured on this switch. Enter a password to set:';
      password = await ctx.promptPassword(message);
      if (password) source = 'user-provided password';
    }

    if (!password) {
      return {
        id, name, status: 'fail',
        detail: 'No root password configured and none could be obtained — subsequent checks will be skipped',
        raw: cmd.output,
      };
    }

    // 3. Configure the password on the switch
    try {
      await runner.ensureConfigMode();

      const newPwPrompt = await runner.sendAndWaitFor(
        'set system root-authentication plain-text-password\n',
        /[Nn]ew password:/,
        10000,
      );
      if (!newPwPrompt.matched) {
        throw new Error('Did not receive new-password prompt from switch');
      }

      const retypePrompt = await runner.sendAndWaitFor(
        password + '\n',
        /[Rr]etype/,
        10000,
      );
      if (!retypePrompt.matched) {
        throw new Error('Did not receive retype prompt from switch');
      }

      const afterConfirm = await runner.sendAndWaitFor(
        password + '\n',
        /#\s*$/,
        10000,
      );
      if (!afterConfirm.matched) {
        throw new Error('Password confirmation did not return to config prompt');
      }

      const commitResult = await runner.execute('commit', 30000);
      await runner.ensureOperationalMode();

      const committed = commitResult.output.includes('commit complete');
      return {
        id, name,
        status: committed ? 'pass' : 'warn',
        detail: committed
          ? `Root password configured and committed (${source})`
          : `Root password set but commit result unclear (${source})`,
        raw: commitResult.output,
      };
    } catch (err) {
      await runner.ensureOperationalMode().catch(() => {});
      return {
        id, name, status: 'fail',
        detail: `Failed to configure root password: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  remediation(result) {
    if (result.status === 'fail') {
      return {
        text: 'Set a root password in configuration mode. If this switch is being onboarded to Mist, the Mist site root password will be applied automatically when you run the adoption commands.',
        commands: [
          'configure',
          'set system root-authentication plain-text-password',
          '  <enter new password when prompted>',
          'commit',
          'exit',
        ],
      };
    }
    return {};
  },
};
