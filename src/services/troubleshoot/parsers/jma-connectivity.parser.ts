import type { CloudMonitorSeverity, JmaConnectivityStatus } from '../../../types/cloud-status.types';

interface JmaConnectivityDefinition {
  name: string;
  severity: CloudMonitorSeverity;
  detail: string;
}

export const JMA_CONNECTIVITY_STATE_MAP: Record<number, JmaConnectivityDefinition> = {
  0: { name: 'None', severity: 'info', detail: 'No cloud connectivity state has been reported yet.' },
  101: { name: 'BootComplete', severity: 'info', detail: 'Boot completed, but cloud connectivity checks have not yet produced a result.' },
  102: { name: 'NoIPAddress', severity: 'fail', detail: 'The switch reports no management IP address.' },
  103: { name: 'NoDefaultGateway', severity: 'fail', detail: 'The switch reports a management IP but no default gateway.' },
  104: { name: 'DefaultGatewayUnreachable', severity: 'fail', detail: 'The switch reports a default gateway that is not reachable.' },
  105: { name: 'NoDNS', severity: 'fail', detail: 'The switch reports no configured DNS servers.' },
  106: { name: 'DNSLookupFailed', severity: 'fail', detail: 'The switch reports DNS is configured but cloud hostname lookup failed.' },
  107: { name: 'ConnectionRequestSent', severity: 'warn', detail: 'The switch has initiated a cloud connection attempt.' },
  108: { name: 'CloudUnreachable', severity: 'fail', detail: 'The switch passed local network checks but could not reach the Mist cloud.' },
  109: { name: 'CloudAuthFailure', severity: 'fail', detail: 'The switch reached the cloud but authentication failed.' },
  110: { name: 'ServiceDown', severity: 'fail', detail: 'A Mist connectivity service on the switch is down.' },
  111: { name: 'Connected', severity: 'pass', detail: 'The switch reports a healthy authenticated Mist cloud connection.' },
  112: { name: 'HealthIssue', severity: 'warn', detail: 'The switch reports a connected-but-unhealthy Mist cloud session.' },
  113: { name: 'NoDNSResponse', severity: 'fail', detail: 'The switch reports the DNS server is unreachable at the network level.' },
  114: { name: 'EmptyDNSResponse', severity: 'fail', detail: 'The switch reports DNS returned no IPs for the cloud hostname.' },
  115: { name: 'SoftwareDownloadFailure', severity: 'warn', detail: 'The switch reports a software image download failure.' },
  116: { name: 'SoftwareUpgradeFailure', severity: 'warn', detail: 'The switch reports a software upgrade failure.' },
  117: { name: 'SoftwareUpgradeInProgress', severity: 'info', detail: 'The switch reports a software upgrade is in progress.' },
  118: { name: 'SoftwareDownloadComplete', severity: 'info', detail: 'The switch reports a software image download completed.' },
  119: { name: 'CloudReady', severity: 'info', detail: 'The switch reports it is provisioned and ready to connect to Mist.' },
  151: { name: 'DuplicateIPAddress', severity: 'fail', detail: 'The switch reports a duplicate IP condition.' },
};

export function parseJmaConnectivityState(output: string): JmaConnectivityStatus {
  const lines = output.split('\n').map((line) => line.trimEnd());
  const headerIndex = lines.findIndex((line) => /\bcc-state\b/i.test(line) && /\bcc-message\b/i.test(line));
  if (headerIndex === -1) {
    return {
      code: null,
      name: 'Unknown',
      severity: 'unknown',
      label: 'Unknown',
      message: '',
      errno: null,
      detail: 'Could not find JMA connectivity state fields in command output.',
    };
  }

  const valueLine = lines.slice(headerIndex + 1).find((line) => line.trim().length > 0);
  if (!valueLine) {
    return {
      code: null,
      name: 'Unknown',
      severity: 'unknown',
      label: 'Unknown',
      message: '',
      errno: null,
      detail: 'JMA connectivity state fields were present, but no value row was found.',
    };
  }

  const exactMatch = valueLine.match(/^(\d+)\s+(.+?)\s+(-?\d+)\s*$/);
  const parts = exactMatch ? [exactMatch[1], exactMatch[2], exactMatch[3]] : valueLine.trim().split(/\s{2,}/);
  const code = Number(parts[0]);
  const message = parts[1]?.trim() || '';
  const errno = parts[2] != null ? Number(parts[2]) : null;

  if (!Number.isFinite(code)) {
    return {
      code: null,
      name: 'Unknown',
      severity: 'unknown',
      label: 'Unknown',
      message,
      errno: Number.isFinite(errno) ? errno : null,
      detail: 'Could not parse the JMA connectivity state value row.',
    };
  }

  const mapped = JMA_CONNECTIVITY_STATE_MAP[code];
  const name = mapped?.name ?? `State${code}`;
  return {
    code,
    name,
    severity: mapped?.severity ?? 'info',
    label: `${code} ${name}`,
    message,
    errno: Number.isFinite(errno) ? errno : null,
    detail: mapped?.detail ?? `The switch reported JMA connectivity state ${code}.`,
  };
}
