import { registerCheck } from '../runner.js';

registerCheck('mgmt-vlan-reachable', async (ctx, cli) => {
  const target = ctx.defaultGateway ?? ctx.managementIp!;
  const out = await cli.run(`ping ${target} count 3 rapid`, 15_000).catch((e: Error) => e.message);
  const loss = parseLoss(out);
  if (loss === 0) {
    return { checkId: 'mgmt-vlan-reachable', status: 'pass', summary: `Gateway ${target} reachable (0% loss)` };
  }
  return {
    checkId: 'mgmt-vlan-reachable',
    status: 'fail',
    summary: `Gateway ${target} unreachable (${loss}% loss) — check layer-2 path and VLAN config`,
    rawOutput: out,
  };
});

function parseLoss(output: string): number {
  const m = output.match(/(\d+)%\s+packet loss/);
  return m ? parseInt(m[1]!, 10) : 100;
}
