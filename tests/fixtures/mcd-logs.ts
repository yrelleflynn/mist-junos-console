/**
 * Representative mcd log fixtures for parser tests.
 *
 * These fixtures are intentionally short but realistic. They are test content
 * only and are not wired into app/runtime code.
 *
 * Format:
 *   [mcd] YYYY/MM/DD HH:MM:SS <file>:<line>: <message>
 */

export interface McdLogFixture {
  id: string;
  title: string;
  validates: string[];
  log: string;
}

const P = (t: string, msg: string) => `[mcd] 2026/04/21 ${t} ${msg}`;

/**
 * keep-alive timeout / jmd-unresponsive path.
 * Includes:
 * - SetState extraction (110, then 111 in trailing cycle)
 * - cycle split at app.go:1040
 * - retry interval extraction (1s)
 * - kill-path classification (keep-alive-timeout)
 * - disconnect-reason parsing + same-cycle 574 event_sent refinement
 */
export const MCD_FIXTURE_KEEPALIVE_TIMEOUT: McdLogFixture = {
  id: 'keepalive-timeout',
  title: 'keep-alive timeout / jmd unresponsive',
  validates: [
    'kill-path: keep-alive-timeout',
    'cycle split at app.go:1040',
    'SetState extraction',
    'retry interval extraction',
    '511 + 574 event_sent refinement',
  ],
  log: [
    P('10:00:01', 'ccstate.go:243: SetState(110)'),
    P('10:00:02', 'app.go:865: ipc keep-alive timeout; last received "61s" ago'),
    P('10:00:03', 'ccstate.go:511: updated disconnect reason: {"timestamp":"2026-04-21T10:00:03Z","cc_state":110,"reason":"jmd keep-alive timeout","event_sent":false}'),
    P('10:00:04', 'monitor.go:238: killing monitored process'),
    P('10:00:05', 'ccstate.go:574: updated disconnect reason event sent status: {"timestamp":"2026-04-21T10:00:03Z","cc_state":110,"reason":"jmd keep-alive timeout","event_sent":true}'),
    P('10:00:06', 'app.go:1040: will try again in 1s'),
    P('10:00:07', 'monitor.go:211: started jmd process'),
    P('10:00:08', 'ccstate.go:243: SetState(111)'),
  ].join('\n'),
};

/**
 * cloud-disconnect path.
 * Includes:
 * - cloud-disconnect markers (ipc_server stop + ctx canceled)
 * - SetState and retry extraction
 * - cycle splitting across two bounded cycles
 */
export const MCD_FIXTURE_CLOUD_DISCONNECT: McdLogFixture = {
  id: 'cloud-disconnect',
  title: 'cloud-disconnect path',
  validates: [
    'kill-path: cloud-disconnect',
    'SetState extraction',
    'retry interval extraction',
    'multi-cycle splitting',
  ],
  log: [
    P('11:10:01', 'ipc_server.go:161: stopping ipc server'),
    P('11:10:01', 'app.go:1110: ctx canceled; exiting sendCloudMsgs'),
    P('11:10:02', 'monitor.go:238: killing monitored process'),
    P('11:10:03', 'ccstate.go:243: SetState(110)'),
    P('11:10:04', 'app.go:1040: will try again in 1s'),
    P('11:10:05', 'ccstate.go:243: SetState(108)'),
    P('11:10:06', 'app.go:1040: will try again in 1s'),
  ].join('\n'),
};

/**
 * DNS failure path.
 * Includes:
 * - DNS failure signal (LookupIP timeout)
 * - SetState(106)
 * - 511 parse and 574 event_sent refinement in same cycle
 * - cycle boundary and retry interval (60s)
 */
export const MCD_FIXTURE_DNS_FAILURE: McdLogFixture = {
  id: 'dns-failure',
  title: 'dns failure path',
  validates: [
    'SetState(106) extraction',
    'disconnect-reason JSON parsing',
    'event_sent refinement via 574',
    'retry interval 60s',
  ],
  log: [
    P('12:20:00', 'ccstate.go:311: management ip address 10.0.10.22'),
    P('12:20:01', 'ccstate.go:330: default gateway 10.0.10.1'),
    P('12:20:02', 'ccstate.go:368: LookupIP() failed: read udp 10.0.10.22:51588->10.0.10.53:53: i/o timeout'),
    P('12:20:03', 'ccstate.go:243: SetState(106)'),
    P('12:20:04', 'ccstate.go:511: updated disconnect reason: {"timestamp":"2026-04-21T12:20:04Z","cc_state":106,"reason":"DNS lookup failed","event_sent":false}'),
    P('12:20:05', 'ccstate.go:574: updated disconnect reason event sent status: {"timestamp":"2026-04-21T12:20:04Z","cc_state":106,"reason":"DNS lookup failed","event_sent":true}'),
    P('12:20:06', 'app.go:1040: will try again in 60s'),
  ].join('\n'),
};

/**
 * cached-IP recovery path.
 * Includes:
 * - DNS lookup failure
 * - cached cloud IP usage
 * - later transition to connected (111)
 * - cycle splitting and retry extraction
 */
export const MCD_FIXTURE_CACHED_IP_RECOVERY: McdLogFixture = {
  id: 'cached-ip-recovery',
  title: 'cached-IP recovery path',
  validates: [
    'state transition sequence (106 -> 111)',
    'cycle splitting',
    'retry interval extraction',
    'connect.go signal retention',
  ],
  log: [
    P('13:40:01', 'ccstate.go:368: LookupIP() failed: read udp 10.0.20.12:41888->10.0.20.53:53: i/o timeout'),
    P('13:40:02', 'ccstate.go:243: SetState(106)'),
    P('13:40:03', 'connect.go:630: Using cached cloud ip address wss://54.83.10.11:443/ws'),
    P('13:40:04', 'app.go:1040: will try again in 60s'),
    P('13:41:01', 'connect.go:332: websocket connected'),
    P('13:41:02', 'ccstate.go:243: SetState(111)'),
    P('13:41:03', 'app.go:1040: will try again in 1s'),
  ].join('\n'),
};

/**
 * noisy log with sparse signal.
 * Includes many non-signal lines and a small number of signal lines to ensure:
 * - noise filtering
 * - signalLines/totalLines accounting
 * - cycle splitting still works in sparse signal streams
 */
export const MCD_FIXTURE_NOISY_SPARSE: McdLogFixture = {
  id: 'noisy-sparse',
  title: 'noisy log with sparse signal',
  validates: [
    'noise filtering',
    'total vs signal line counting',
    'cycle split with sparse signal',
  ],
  log: [
    P('14:55:00', 'ipc_server.go:200: polling jmd (noise)'),
    P('14:55:05', 'ipc_server.go:200: polling jmd (noise)'),
    P('14:55:10', 'ipc_server.go:200: polling jmd (noise)'),
    P('14:55:15', 'ccstate.go:311: management ip address 10.0.30.5'),
    P('14:55:20', 'ipc_server.go:200: polling jmd (noise)'),
    P('14:55:25', 'ccstate.go:243: SetState(103)'),
    P('14:55:30', 'ipc_server.go:200: polling jmd (noise)'),
    P('14:55:35', 'app.go:1040: will try again in 1s'),
    P('14:55:40', 'ipc_server.go:200: polling jmd (noise)'),
    P('14:55:45', 'ccstate.go:243: SetState(103)'),
  ].join('\n'),
};

/**
 * empty/minimal input fixtures.
 * Intended to validate parser behavior for empty string, empty array semantics,
 * and minimal signal without cycle boundary.
 */
export const MCD_FIXTURE_EMPTY_STRING = '';
export const MCD_FIXTURE_EMPTY_ARRAY: string[] = [];
export const MCD_FIXTURE_MINIMAL_SIGNAL = [
  P('15:10:01', 'ccstate.go:243: SetState(102)'),
];

/**
 * Convenience list for parameterized tests.
 */
export const MCD_LOG_FIXTURES: McdLogFixture[] = [
  MCD_FIXTURE_KEEPALIVE_TIMEOUT,
  MCD_FIXTURE_CLOUD_DISCONNECT,
  MCD_FIXTURE_DNS_FAILURE,
  MCD_FIXTURE_CACHED_IP_RECOVERY,
  MCD_FIXTURE_NOISY_SPARSE,
];

