/**
 * mist-clouds.config.ts — Mist cloud region definitions
 *
 * Contains all cloud regions with their API hosts and EX switch
 * connectivity endpoints, sourced from Juniper documentation:
 * https://www.juniper.net/documentation/us/en/software/mist/mist-management/topics/ref/firewall-ports-to-open.html
 */

export interface MistEndpoint {
  host: string;
  port: number;
  protocol: 'tcp' | 'udp';
  description: string;
}

export interface MistCloud {
  id: string;
  name: string;
  apiHost: string;
  /** EX switch endpoints required for cloud connectivity */
  switchEndpoints: MistEndpoint[];
}

function buildSwitchEndpoints(cloudDomain: string, ocTermHost?: string, jmaHost?: string): MistEndpoint[] {
  const oc = ocTermHost ?? `oc-term.${cloudDomain}`;
  const jma = jmaHost ?? `jma-terminator.${cloudDomain}`;
  const ztp = `ztp.${cloudDomain}`;

  const endpoints: MistEndpoint[] = [
    { host: 'redirect.juniper.net', port: 443, protocol: 'tcp', description: 'Redirect service' },
    { host: jma, port: 443, protocol: 'tcp', description: 'JMA terminator' },
    { host: ztp, port: 443, protocol: 'tcp', description: 'Zero Touch Provisioning' },
    { host: oc, port: 2200, protocol: 'tcp', description: 'Outbound SSH (oc-term)' },
  ];

  // cdn.juniper.net is required for all clouds except Global 01
  if (cloudDomain !== 'mist.com') {
    endpoints.push({ host: 'cdn.juniper.net', port: 443, protocol: 'tcp', description: 'CDN for firmware/images' });
  }

  return endpoints;
}

export const MIST_CLOUDS: MistCloud[] = [
  {
    id: 'global01',
    name: 'Global 01',
    apiHost: 'api.mist.com',
    switchEndpoints: buildSwitchEndpoints('mist.com', 'oc-term.mistsys.net', 'jma-terminator.mistsys.net'),
  },
  {
    id: 'global02',
    name: 'Global 02',
    apiHost: 'api.gc1.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc1.mist.com'),
  },
  {
    id: 'global03',
    name: 'Global 03',
    apiHost: 'api.ac2.mist.com',
    switchEndpoints: buildSwitchEndpoints('ac2.mist.com'),
  },
  {
    id: 'global04',
    name: 'Global 04',
    apiHost: 'api.gc2.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc2.mist.com'),
  },
  {
    id: 'global05',
    name: 'Global 05',
    apiHost: 'api.gc4.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc4.mist.com'),
  },
  {
    id: 'emea01',
    name: 'EMEA 01',
    apiHost: 'api.eu.mist.com',
    switchEndpoints: buildSwitchEndpoints('eu.mist.com'),
  },
  {
    id: 'emea02',
    name: 'EMEA 02',
    apiHost: 'api.gc3.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc3.mist.com'),
  },
  {
    id: 'emea03',
    name: 'EMEA 03',
    apiHost: 'api.ac6.mist.com',
    switchEndpoints: buildSwitchEndpoints('ac6.mist.com'),
  },
  {
    id: 'emea04',
    name: 'EMEA 04',
    apiHost: 'api.gc6.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc6.mist.com'),
  },
  {
    id: 'apac01',
    name: 'APAC 01',
    apiHost: 'api.ac5.mist.com',
    switchEndpoints: buildSwitchEndpoints('ac5.mist.com'),
  },
  {
    id: 'apac02',
    name: 'APAC 02',
    apiHost: 'api.gc5.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc5.mist.com'),
  },
  {
    id: 'apac03',
    name: 'APAC 03',
    apiHost: 'api.gc7.mist.com',
    switchEndpoints: buildSwitchEndpoints('gc7.mist.com'),
  },
];

export function getCloudById(id: string): MistCloud | undefined {
  return MIST_CLOUDS.find((c) => c.id === id);
}
