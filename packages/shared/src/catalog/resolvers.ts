import type { ContextResolverDefinition } from './check-definition.types.js';

export const RESOLVERS: readonly ContextResolverDefinition[] = [
  {
    id: 'uplink-port',
    description: 'Discovers the active uplink port and its operational status via show interfaces',
    provides: ['uplinkPort', 'uplinkPortStatus', 'uplinkPortErrors'],
    needs: [],
  },
  {
    id: 'management-ip',
    description: 'Reads management IP, prefix length, and VLAN from show interfaces irb / show interfaces me0',
    provides: ['managementIp', 'managementPrefix', 'managementVlan'],
    needs: [],
  },
  {
    id: 'default-gateway',
    description: 'Extracts the default gateway from show route 0.0.0.0/0',
    provides: ['defaultGateway'],
    needs: [],
  },
  {
    id: 'dns-servers',
    description: 'Reads configured DNS resolvers from show system name-servers',
    provides: ['dnsServers'],
    needs: [],
  },
  {
    id: 'jma-state',
    description: 'Reads JMA cloud connectivity state code from show system jma',
    provides: ['jmaState', 'mistEndpoint'],
    needs: [],
  },
  {
    id: 'mcd-log-file',
    description: 'Determines the correct MCD log filename (jmd.log vs mist.log) based on Junos version',
    provides: ['mcdLogFile'],
    needs: [],
  },
  {
    id: 'mcd-logs',
    description: 'Reads MCD/JMD log lines from the switch around the offline window',
    provides: ['mcdLogLines'],
    needs: ['mcdLogFile', 'offlineAt'],
  },
  {
    id: 'mist-last-seen',
    description: 'Fetches device last_seen timestamp and SW_CONFIG_CHANGED_BY_USER events from Mist API',
    provides: ['mistLastSeen', 'offlineAt', 'mistEventsNearOffline'],
    needs: ['mistSession', 'deviceMatch'],
  },
] as const;
