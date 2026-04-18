/**
 * dhcp-refresh.service.ts — DHCP lease renewal via IRB disable/rollback cycle
 *
 * Workflow:
 *   1. Capture current DHCP client bindings (before state)
 *   2. Enter configure mode
 *   3. Disable every DHCP client interface (`set interfaces <x> unit <n> disable`)
 *   4. Commit — forces the DHCP client to release leases on those interfaces
 *   5. Rollback 1 — loads the prior committed config (without the disable statements)
 *   6. Commit — re-enables the interfaces, triggering DHCP discovery/renewal
 *   7. Exit configure mode
 *   8. Wait briefly for DHCP to negotiate
 *   9. Capture bindings again (after state) and compare
 *
 * The disable/commit/rollback/commit cycle is deliberately visible in the
 * terminal — it modifies the running config and operators should see it.
 * Only the pre/post binding reads run silently.
 */

import { CommandRunnerService } from './command-runner.service';

export interface DhcpBinding {
  /** e.g. irb.0, vme.0, ge-0/0/0.0 */
  interface: string;
  /** Bound IP, or 0.0.0.0 when not yet acquired */
  ipAddress: string;
  hwAddress: string;
  /** Remaining lease time in seconds (0 when SELECTING) */
  expiresSeconds: number;
  /** e.g. BOUND, SELECTING, RENEWING, REBINDING, INIT */
  state: string;
  /** DHCP server IP, or null when unknown */
  serverIdentifier: string | null;
  /** ISO-8601 UTC string, or null when not available */
  leaseStart: string | null;
  /** ISO-8601 UTC string, or null when not available */
  leaseExpires: string | null;
}

export type DhcpBindingOutcome =
  | 'renewed'       // Was BOUND, still BOUND with a new lease start time
  | 'acquired'      // Was not BOUND, now BOUND — got a new lease
  | 'no-response'   // Still SELECTING / INIT after the cycle
  | 'unchanged'     // BOUND before and after with identical lease start
  | 'lost'          // Was BOUND, no longer in the binding table
  | 'unknown';

export interface DhcpBindingChange {
  interface: string;
  before: DhcpBinding | null;
  after: DhcpBinding | null;
  outcome: DhcpBindingOutcome;
}

export interface DhcpRefreshResult {
  /** Interfaces targeted by the disable/commit cycle */
  targetInterfaces: string[];
  before: DhcpBinding[];
  after: DhcpBinding[];
  changes: DhcpBindingChange[];
  commitDisableSuccess: boolean;
  commitRestoreSuccess: boolean;
  errors: string[];
}

/** How long to wait after the second commit before re-reading bindings */
const POST_COMMIT_WAIT_MS = 5000;

export class DhcpRefreshService {
  constructor(private readonly runner: CommandRunnerService) {}

  // ---- Public API --------------------------------------------------------

  async refresh(): Promise<DhcpRefreshResult> {
    const errors: string[] = [];

    // 1. Read current bindings — silently so the terminal stays clean
    const before = await this.readBindings({ silent: true });

    if (before.length === 0) {
      return {
        targetInterfaces: [],
        before: [],
        after: [],
        changes: [],
        commitDisableSuccess: false,
        commitRestoreSuccess: false,
        errors: ['No DHCP client bindings found on this switch.'],
      };
    }

    const targetInterfaces = before.map((b) => b.interface);

    // 2. Guard: refuse if already in config mode (another workflow may own it)
    const mode = await this.runner.detectMode();
    if (mode === 'config') {
      return {
        targetInterfaces,
        before,
        after: [],
        changes: [],
        commitDisableSuccess: false,
        commitRestoreSuccess: false,
        errors: [
          'Switch is already in configuration mode. Exit or commit/rollback the current candidate before running DHCP refresh.',
        ],
      };
    }

    // 3. Enter config mode (visible — operator action that modifies config)
    await this.runner.ensureConfigMode();

    // 4. Disable each DHCP client interface
    for (const iface of targetInterfaces) {
      const path = ifaceToJunosPath(iface);
      await this.runner.execute(`set ${path} disable`, 10000, 2000);
    }

    // 5. First commit — forces DHCP release
    const commit1 = await this.runner.execute('commit', 60000, 5000);
    const commitDisableSuccess = /commit complete/i.test(commit1.output);

    if (!commitDisableSuccess) {
      // Roll back our staged changes and bail out
      await this.runner.execute('rollback 0', 10000, 2000);
      await this.runner.execute('exit', 5000, 2000);
      return {
        targetInterfaces,
        before,
        after: [],
        changes: [],
        commitDisableSuccess: false,
        commitRestoreSuccess: false,
        errors: [
          'First commit (disable interfaces) failed — rolled back, no permanent changes made.',
          commit1.output.trim(),
        ],
      };
    }

    // 6. Rollback 1 — load the prior committed config (without disable statements)
    await this.runner.execute('rollback 1', 10000, 2000);

    // 7. Second commit — re-enables interfaces, triggers DHCP discovery
    const commit2 = await this.runner.execute('commit', 60000, 5000);
    const commitRestoreSuccess = /commit complete/i.test(commit2.output);

    if (!commitRestoreSuccess) {
      errors.push(
        'Second commit (restore interfaces) failed — switch may need manual intervention to re-enable interfaces.',
      );
    }

    // 8. Exit configure mode
    await this.runner.execute('exit', 5000, 2000);

    // 9. Wait for DHCP to negotiate
    await new Promise<void>((resolve) => setTimeout(resolve, POST_COMMIT_WAIT_MS));

    // 10. Read bindings again — silently
    const after = await this.readBindings({ silent: true });

    // 11. Build change summary
    const changes = buildChanges(targetInterfaces, before, after);

    return {
      targetInterfaces,
      before,
      after,
      changes,
      commitDisableSuccess,
      commitRestoreSuccess,
      errors,
    };
  }

  // ---- Parsing (exported for testing) ------------------------------------

  parseSummary(output: string): Pick<DhcpBinding, 'interface' | 'ipAddress' | 'hwAddress' | 'expiresSeconds' | 'state'>[] {
    const bindings: Pick<DhcpBinding, 'interface' | 'ipAddress' | 'hwAddress' | 'expiresSeconds' | 'state'>[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || /^IP\s+address/i.test(trimmed)) continue;
      // Format: <ip>  <hw>  <expires>  <state>  <interface>
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(parts[0])) continue;
      bindings.push({
        ipAddress: parts[0],
        hwAddress: parts[1],
        expiresSeconds: parseInt(parts[2], 10) || 0,
        state: parts[3],
        interface: parts[4],
      });
    }
    return bindings;
  }

  parseDetail(output: string): Map<string, Pick<DhcpBinding, 'serverIdentifier' | 'leaseStart' | 'leaseExpires'>> {
    const map = new Map<string, Pick<DhcpBinding, 'serverIdentifier' | 'leaseStart' | 'leaseExpires'>>();
    // Each binding block starts with "Client Interface/Id: <iface>"
    for (const block of output.split(/(?=Client Interface\/Id:)/)) {
      const ifaceMatch = block.match(/Client Interface\/Id:\s*(\S+)/);
      if (!ifaceMatch) continue;
      const iface = ifaceMatch[1];

      const serverMatch = block.match(/Server Identifier:\s*(\S+)/);
      const leaseStartMatch = block.match(/Lease Start:\s*(.+?UTC)/);
      const leaseExpiresMatch = block.match(/Lease Expires:\s*(.+?UTC)/);

      map.set(iface, {
        serverIdentifier: serverMatch?.[1] ?? null,
        leaseStart: leaseStartMatch?.[1]?.trim() ?? null,
        leaseExpires: leaseExpiresMatch?.[1]?.trim() ?? null,
      });
    }
    return map;
  }

  // ---- Private -----------------------------------------------------------

  private async readBindings(options: { silent: boolean }): Promise<DhcpBinding[]> {
    const summary = await this.runner.execute('show dhcp client binding', 15000, 2000, options);
    const detail = await this.runner.execute('show dhcp client binding detail', 15000, 2000, options);

    const base = this.parseSummary(summary.output);
    const detailMap = this.parseDetail(detail.output);

    return base.map((b) => ({
      ...b,
      serverIdentifier: detailMap.get(b.interface)?.serverIdentifier ?? null,
      leaseStart: detailMap.get(b.interface)?.leaseStart ?? null,
      leaseExpires: detailMap.get(b.interface)?.leaseExpires ?? null,
    }));
  }
}

// ---- Pure helpers (exported for testing) ----------------------------------

/**
 * Convert a Junos logical interface name to a config path suitable for
 * `set interfaces ... disable`.
 *
 * Examples:
 *   irb.0      → interfaces irb unit 0
 *   vme.0      → interfaces vme unit 0
 *   ge-0/0/0.0 → interfaces ge-0/0/0 unit 0
 */
export function ifaceToJunosPath(iface: string): string {
  const match = iface.match(/^(.+)\.(\d+)$/);
  if (match) return `interfaces ${match[1]} unit ${match[2]}`;
  return `interfaces ${iface} unit 0`;
}

/**
 * Classify the outcome for each targeted interface by comparing before/after.
 */
export function buildChanges(
  targetInterfaces: string[],
  before: DhcpBinding[],
  after: DhcpBinding[],
): DhcpBindingChange[] {
  const afterMap = new Map(after.map((b) => [b.interface, b]));
  const beforeMap = new Map(before.map((b) => [b.interface, b]));

  // Targeted interfaces first, then any new interfaces that appeared
  const allIfaces = [...new Set([...targetInterfaces, ...after.map((b) => b.interface)])];

  return allIfaces.map((iface) => {
    const b = beforeMap.get(iface) ?? null;
    const a = afterMap.get(iface) ?? null;
    return { interface: iface, before: b, after: a, outcome: classifyOutcome(b, a) };
  });
}

function classifyOutcome(before: DhcpBinding | null, after: DhcpBinding | null): DhcpBindingOutcome {
  const wasBound = before?.state?.toUpperCase() === 'BOUND';
  const nowBound = after?.state?.toUpperCase() === 'BOUND';

  if (!after) return before ? 'lost' : 'unknown';
  if (!nowBound) return 'no-response';
  if (!wasBound) return 'acquired';

  // Both bound — compare lease start to detect renewal
  if (before!.leaseStart && after.leaseStart && before!.leaseStart !== after.leaseStart) {
    return 'renewed';
  }
  return 'unchanged';
}
