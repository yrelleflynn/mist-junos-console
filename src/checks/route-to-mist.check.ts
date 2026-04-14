import type { Check, CheckContext, CheckResult } from './base';

export const routeToMistCheck: Check = {
  id: 'route-to-mist',
  name: 'Route to Mist Endpoints',

  async run({ runner, cloud }: CheckContext): Promise<CheckResult> {
    const id = 'route-to-mist';
    const name = 'Route to Mist Endpoints';

    if (!cloud) {
      return { id, name, status: 'skip', detail: 'No cloud config provided' };
    }

    const ocTerm = cloud.switchEndpoints.find((e) => e.description.includes('oc-term'));
    const testHost = ocTerm?.host || cloud.switchEndpoints[0]?.host;

    if (!testHost) {
      return { id, name, status: 'skip', detail: 'No endpoint to check' };
    }

    const hostCmd = await runner.execute(`show host ${testHost}`, 15000, 2000);
    let testIp: string | null = null;
    if (hostCmd.success) {
      const addrMatch = hostCmd.output.match(/has address\s+(\d+\.\d+\.\d+\.\d+)/);
      if (addrMatch) testIp = addrMatch[1];
    }

    if (!testIp) {
      return { id, name, status: 'warn', detail: `Could not resolve ${testHost} to check route`, raw: hostCmd.output };
    }

    const routeCmd = await runner.execute(`show route ${testIp}`, 15000);
    if (!routeCmd.success) {
      return { id, name, status: 'fail', detail: `Could not check route to ${testIp}`, raw: routeCmd.output };
    }

    const hasRoute = routeCmd.output.includes(testIp) || routeCmd.output.includes('0.0.0.0/0');
    if (!hasRoute && routeCmd.output.includes('not found')) {
      return { id, name, status: 'fail', detail: `No route to ${testIp} (${testHost})`, raw: routeCmd.output };
    }

    const nhMatch = routeCmd.output.match(/>\s*to\s+(\d+\.\d+\.\d+\.\d+)/i) ||
                    routeCmd.output.match(/via\s+(\S+)/i);
    const nextHop = nhMatch ? nhMatch[1] : '';
    const nhDetail = nextHop ? ` via ${nextHop}` : '';

    return { id, name, status: 'pass', detail: `Route to ${testIp} (${testHost})${nhDetail}`, raw: routeCmd.output };
  },

  remediation(_result, allResults) {
    const routeFailed = allResults?.find((x) => x.id === 'default-route')?.status === 'fail';
    if (routeFailed) return { text: 'No default route — fix Default Gateway first.' };
    return { text: 'Default route exists but no path to Mist IP. Check policy routing or ACLs.' };
  },
};
