import type { GroupId } from '../types/check.js';

export interface GroupDefinition {
  readonly id: GroupId;
  readonly label: string;
  readonly description: string;
  readonly order: number;
}

export const GROUPS: readonly GroupDefinition[] = [
  {
    id: 'connectivity',
    label: 'Connectivity',
    description: 'Uplink port health, management IP assignment, and layer-2/3 reachability',
    order: 1,
  },
  {
    id: 'routing',
    label: 'Routing',
    description: 'Default route presence, ARP resolution, and routing table checks',
    order: 2,
  },
  {
    id: 'dns',
    label: 'DNS',
    description: 'DNS resolver reachability and Mist endpoint name resolution',
    order: 3,
  },
  {
    id: 'mist-cloud',
    label: 'Mist Cloud',
    description: 'JMA state, Mist endpoint reachability, NTP sync, and WebSocket connection',
    order: 4,
  },
  {
    id: 'history',
    label: 'Offline History',
    description: 'Last-seen timestamp correlation with MCD logs and Mist config change events',
    order: 5,
  },
] as const;
