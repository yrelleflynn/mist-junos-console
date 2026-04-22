/**
 * mcd-log-parser.test.ts
 *
 * Unit tests for the mcd log parser.
 *
 * Fixtures are inline and use realistic mcd log line format:
 *   [mcd] YYYY/MM/DD HH:MM:SS <filename>:<lineno>: <message>
 *
 * The parser matches on text content patterns, not line numbers, so the
 * specific line numbers in fixtures are illustrative only.
 */

import { describe, expect, it } from 'vitest'

import { parseMcdLog } from '../src/features/troubleshoot/mcd-log-parser'
import type { McdParsedLog } from '../src/features/troubleshoot/mcd-log-parser.types'
import {
  MCD_FIXTURE_CACHED_IP_RECOVERY,
  MCD_FIXTURE_CLOUD_DISCONNECT,
  MCD_FIXTURE_KEEPALIVE_TIMEOUT,
} from './fixtures/mcd-logs'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ts = (hh: string) => `[mcd] 2026/04/20 ${hh} `

// A minimal noise line — high-volume ipc_server.go polling, should be filtered
const NOISE_LINE = `${ts('14:30:00')}ipc_server.go:200: some polling heartbeat`

// Common signal lines
const IP_FOUND   = `${ts('14:30:01')}ccstate.go:311: management ip address 10.0.0.5`
const NO_IP      = `${ts('14:30:01')}ccstate.go:308: no management ip address`
const GW_OK      = `${ts('14:30:01')}ccstate.go:346: default gateway is reachable`
const GW_FAIL    = `${ts('14:30:01')}ccstate.go:334: default gateway not reachable, default gateway ip: 10.0.0.1`
const DNS_OK     = `${ts('14:30:01')}ccstate.go:380: dns lookup for jma-terminator.mistsys.net is good`
const DNS_FAIL   = `${ts('14:30:01')}ccstate.go:368: LookupIP() failed: read udp: i/o timeout`
const CONNECTED  = `${ts('14:30:02')}connect.go:332: connection established`
const JMD_KILLED = `${ts('14:30:03')}monitor.go:238: killing monitored process`
const JMD_START  = `${ts('14:30:04')}monitor.go:211: started jmd process`

const setStateLine = (code: number, hh = '14:30:01') =>
  `${ts(hh)}ccstate.go:243: SetState(${code})`

const retryLine = (secs: number) =>
  `${ts('14:30:05')}app.go:1040: will try again in ${secs}s`

const keepAliveTimeoutLine =
  `${ts('14:30:02')}app.go:865: ipc keep-alive timeout; last received "62s" ago`

const ipcServerStopLine =
  `${ts('14:30:02')}ipc_server.go:161: stopping ipc server`

const ctxCanceledLine =
  `${ts('14:30:02')}app.go:1110: ctx canceled; exiting sendCloudMsgs`

const disconnectReasonLine = (
  ccState: number,
  reason: string,
  eventSent: boolean,
  isoTs = '2026-04-20T14:30:01Z',
) =>
  `${ts('14:30:01')}ccstate.go:511: updated disconnect reason: ` +
  JSON.stringify({ timestamp: isoTs, cc_state: ccState, reason, event_sent: eventSent })

const disconnectSentLine = (
  ccState: number,
  reason: string,
  isoTs = '2026-04-20T14:30:01Z',
) =>
  `${ts('14:30:03')}ccstate.go:574: updated disconnect reason event sent status: ` +
  JSON.stringify({ timestamp: isoTs, cc_state: ccState, reason, event_sent: true })

// ---------------------------------------------------------------------------
// Empty / minimal input
// ---------------------------------------------------------------------------

describe('empty and minimal input', () => {
  it('returns zero cycles for an empty string', () => {
    const result = parseMcdLog('')
    expect(result.cycles).toHaveLength(0)
    expect(result.totalLines).toBe(1) // split('\n') on '' gives ['']
    expect(result.signalLines).toBe(0)
  })

  it('returns zero cycles for an empty array', () => {
    const result = parseMcdLog([])
    expect(result.cycles).toHaveLength(0)
    expect(result.totalLines).toBe(0)
    expect(result.signalLines).toBe(0)
  })

  it('returns zero cycles for noise-only input', () => {
    const result = parseMcdLog([NOISE_LINE, NOISE_LINE, NOISE_LINE])
    expect(result.cycles).toHaveLength(0)
    expect(result.totalLines).toBe(3)
    expect(result.signalLines).toBe(0)
  })

  it('returns one trailing cycle for signal lines with no cycle boundary', () => {
    const result = parseMcdLog([IP_FOUND, setStateLine(102)])
    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0].retryIntervalSeconds).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Cycle splitting
// ---------------------------------------------------------------------------

describe('cycle splitting', () => {
  it('produces one cycle per app.go:1040 boundary', () => {
    const log = [
      IP_FOUND,
      setStateLine(106),
      retryLine(60),
      // ── cycle 1 ends ──
      IP_FOUND,
      setStateLine(106),
      retryLine(60),
      // ── cycle 2 ends ──
    ]
    const result = parseMcdLog(log)
    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0].cycleNumber).toBe(1)
    expect(result.cycles[1].cycleNumber).toBe(2)
  })

  it('collects trailing lines into a final incomplete cycle', () => {
    const log = [
      setStateLine(106),
      retryLine(60),
      // ── cycle 1 ends ──
      IP_FOUND,
      setStateLine(103),
      // ── no boundary — trailing cycle ──
    ]
    const result = parseMcdLog(log)
    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[1].retryIntervalSeconds).toBeNull()
    expect(result.cycles[1].states).toEqual([103])
  })

  it('accepts a raw string and splits on newlines', () => {
    const log = [IP_FOUND, setStateLine(102), retryLine(1)].join('\n')
    const result = parseMcdLog(log)
    expect(result.cycles).toHaveLength(1)
  })

  it('assigns cycle numbers in order starting at 1', () => {
    const log = [retryLine(1), retryLine(60), retryLine(1)]
    const result = parseMcdLog(log)
    expect(result.cycles.map(c => c.cycleNumber)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// Noise filtering
// ---------------------------------------------------------------------------

describe('noise filtering', () => {
  it('excludes non-signal lines from rawLines', () => {
    const log = [NOISE_LINE, IP_FOUND, NOISE_LINE, setStateLine(111), NOISE_LINE, retryLine(1)]
    const result = parseMcdLog(log)
    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0].rawLines).not.toContain(NOISE_LINE)
    expect(result.cycles[0].rawLines).toContain(IP_FOUND)
  })

  it('counts total lines including noise', () => {
    const log = [NOISE_LINE, IP_FOUND, NOISE_LINE, retryLine(1)]
    const result = parseMcdLog(log)
    expect(result.totalLines).toBe(4)
    expect(result.signalLines).toBe(2) // IP_FOUND + retryLine
  })
})

// ---------------------------------------------------------------------------
// SetState extraction
// ---------------------------------------------------------------------------

describe('SetState extraction', () => {
  it('extracts a single SetState call', () => {
    const result = parseMcdLog([setStateLine(106), retryLine(60)])
    expect(result.cycles[0].states).toEqual([106])
  })

  it('extracts multiple SetState calls in order', () => {
    const log = [
      setStateLine(111, '14:30:00'),
      setStateLine(103, '14:30:01'),
      setStateLine(104, '14:30:02'),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].states).toEqual([111, 103, 104])
  })

  it('returns empty states array when no SetState lines are present', () => {
    const result = parseMcdLog([IP_FOUND, retryLine(1)])
    expect(result.cycles[0].states).toEqual([])
  })

  it('preserves SetState calls across multiple cycles independently', () => {
    const log = [
      setStateLine(106),
      retryLine(60),
      setStateLine(111),
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].states).toEqual([106])
    expect(result.cycles[1].states).toEqual([111])
  })
})

// ---------------------------------------------------------------------------
// Kill path classification
// ---------------------------------------------------------------------------

describe('kill path classification', () => {
  it('classifies keep-alive-timeout when app.go:865 is present', () => {
    const log = [
      setStateLine(110),
      keepAliveTimeoutLine,
      JMD_KILLED,
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBe('keep-alive-timeout')
  })

  it('classifies cloud-disconnect when ipc_server.go:161 is present', () => {
    const log = [
      ipcServerStopLine,
      JMD_KILLED,
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBe('cloud-disconnect')
  })

  it('classifies cloud-disconnect when app.go:1110 is present (secondary marker)', () => {
    const log = [
      ctxCanceledLine,
      JMD_KILLED,
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBe('cloud-disconnect')
  })

  it('returns null kill path when neither marker is present', () => {
    const log = [setStateLine(106), DNS_FAIL, retryLine(60)]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBeNull()
  })

  it('returns null kill path when both markers are present (ambiguous)', () => {
    const log = [
      keepAliveTimeoutLine,
      ipcServerStopLine,
      JMD_KILLED,
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Retry interval
// ---------------------------------------------------------------------------

describe('retry interval', () => {
  it('extracts the retry interval in seconds', () => {
    const result = parseMcdLog([retryLine(60)])
    expect(result.cycles[0].retryIntervalSeconds).toBe(60)
  })

  it('extracts a 1-second retry interval', () => {
    const result = parseMcdLog([retryLine(1)])
    expect(result.cycles[0].retryIntervalSeconds).toBe(1)
  })

  it('returns null for a trailing cycle with no retry line', () => {
    const result = parseMcdLog([setStateLine(106)])
    expect(result.cycles[0].retryIntervalSeconds).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Disconnect reason parsing
// ---------------------------------------------------------------------------

describe('disconnect reason parsing', () => {
  it('parses a well-formed ccstate.go:511 disconnect reason', () => {
    const log = [
      disconnectReasonLine(106, 'DNS lookup failed', false),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    const dr = result.cycles[0].disconnectReason
    expect(dr).not.toBeNull()
    expect(dr!.cc_state).toBe(106)
    expect(dr!.reason).toBe('DNS lookup failed')
    expect(dr!.event_sent).toBe(false)
    expect(dr!.timestamp).toBe('2026-04-20T14:30:01Z')
  })

  it('returns null when no ccstate.go:511 line is present', () => {
    const result = parseMcdLog([setStateLine(106), retryLine(60)])
    expect(result.cycles[0].disconnectReason).toBeNull()
  })

  it('uses the last ccstate.go:511 when multiple appear in a cycle', () => {
    const log = [
      disconnectReasonLine(103, 'no default gateway', false, '2026-04-20T14:29:00Z'),
      disconnectReasonLine(106, 'DNS lookup failed', false, '2026-04-20T14:30:01Z'),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].disconnectReason!.cc_state).toBe(106)
    expect(result.cycles[0].disconnectReason!.timestamp).toBe('2026-04-20T14:30:01Z')
  })

  it('does not throw on malformed JSON in a ccstate.go:511 line', () => {
    const badLine =
      `${ts('14:30:01')}ccstate.go:511: updated disconnect reason: {not valid json`
    const log = [badLine, retryLine(60)]
    expect(() => parseMcdLog(log)).not.toThrow()
    expect(parseMcdLog(log).cycles[0].disconnectReason).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// event_sent refinement via ccstate.go:574
// ---------------------------------------------------------------------------

describe('event_sent refinement', () => {
  it('leaves event_sent false when no ccstate.go:574 line is present', () => {
    const log = [
      disconnectReasonLine(106, 'DNS lookup failed', false),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(false)
  })

  it('updates event_sent to true when a matching ccstate.go:574 follows', () => {
    const log = [
      disconnectReasonLine(106, 'DNS lookup failed', false),
      disconnectSentLine(106, 'DNS lookup failed'),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(true)
  })

  it('updates event_sent to true when ccstate.go:574 precedes ccstate.go:511', () => {
    // "do not assume only one exact ordering"
    const log = [
      disconnectSentLine(106, 'DNS lookup failed'),
      disconnectReasonLine(106, 'DNS lookup failed', false),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    // The 574 precedes the 511 we anchor on. The parser uses a two-pass
    // approach so ordering within the cycle window does not matter.
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(true)
  })

  it('does not update event_sent when 574 timestamp does not match 511', () => {
    const log = [
      disconnectReasonLine(106, 'DNS lookup failed', false, '2026-04-20T14:30:01Z'),
      disconnectSentLine(103, 'no default gateway', '2026-04-20T14:29:00Z'), // different timestamp
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(false)
  })

  it('updates event_sent when 574 timestamp is equivalent but formatted differently', () => {
    const log = [
      disconnectReasonLine(106, 'DNS lookup failed', false, '2026-04-20T14:30:01Z'),
      disconnectSentLine(106, 'DNS lookup failed', '2026-04-20T14:30:01+00:00'),
      retryLine(60),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(true)
  })

  it('leaves event_sent unchanged when it is already true in the 511 line', () => {
    // event_sent:true can appear in the 511 JSON itself in some cases
    const log = [
      disconnectReasonLine(111, 'connected', true),
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Real-world-flavoured mixed log
// ---------------------------------------------------------------------------

describe('realistic mixed log', () => {
  it('parses a three-cycle DNS failure sequence correctly', () => {
    const ISO_TS = '2026-04-20T14:30:00Z'
    const log = [
      // noise
      NOISE_LINE,
      // cycle 1: DNS fail → retry 60s
      IP_FOUND,
      GW_OK,
      DNS_FAIL,
      setStateLine(106),
      disconnectReasonLine(106, 'DNS lookup failed', false, ISO_TS),
      retryLine(60),
      // noise between cycles
      NOISE_LINE,
      // cycle 2: DNS fail again → retry 60s
      IP_FOUND,
      GW_OK,
      DNS_FAIL,
      setStateLine(106),
      disconnectReasonLine(106, 'DNS lookup failed', false, ISO_TS),
      retryLine(60),
      // cycle 3: DNS resolves, connect, SetState(111) — trailing (no boundary)
      IP_FOUND,
      GW_OK,
      DNS_OK,
      CONNECTED,
      setStateLine(111),
      disconnectSentLine(106, 'DNS lookup failed', ISO_TS),
    ]

    const result: McdParsedLog = parseMcdLog(log)

    expect(result.cycles).toHaveLength(3)

    // cycle 1
    expect(result.cycles[0].states).toEqual([106])
    expect(result.cycles[0].retryIntervalSeconds).toBe(60)
    expect(result.cycles[0].disconnectReason!.cc_state).toBe(106)
    expect(result.cycles[0].disconnectReason!.event_sent).toBe(false)
    expect(result.cycles[0].killPath).toBeNull()

    // cycle 2
    expect(result.cycles[1].states).toEqual([106])
    expect(result.cycles[1].retryIntervalSeconds).toBe(60)

    // cycle 3 (trailing — no retry boundary)
    expect(result.cycles[2].states).toEqual([111])
    expect(result.cycles[2].retryIntervalSeconds).toBeNull()
    // cycle 3 has a ccstate.go:574 confirmation line but no ccstate.go:511 —
    // the 574 references the disconnect reason stored in a previous cycle, not
    // this one. The parser correctly returns null: it only links 574 to 511
    // within the same cycle window.
    expect(result.cycles[2].disconnectReason).toBeNull()

    // line counts
    expect(result.totalLines).toBe(log.length)
    expect(result.signalLines).toBe(log.length - 2) // 2 NOISE_LINE entries
  })

  it('handles a keep-alive-timeout kill followed by jmd restart', () => {
    const log = [
      setStateLine(111),
      keepAliveTimeoutLine,
      JMD_KILLED,
      retryLine(1),
      // ── cycle 1 ends ──
      JMD_START,
      setStateLine(111),
      // ── trailing ──
    ]
    const result = parseMcdLog(log)
    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0].killPath).toBe('keep-alive-timeout')
    expect(result.cycles[1].killPath).toBeNull()
    expect(result.cycles[1].states).toEqual([111])
  })

  it('handles a cloud-disconnect kill sequence correctly', () => {
    const log = [
      ipcServerStopLine,
      ctxCanceledLine,
      JMD_KILLED,
      setStateLine(110),
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBe('cloud-disconnect')
    expect(result.cycles[0].states).toEqual([110])
  })
})

// ---------------------------------------------------------------------------
// Format variance and marker drift
// ---------------------------------------------------------------------------

describe('format variance and marker drift', () => {
  it('splits cycles using retry message text even when app.go line number changes', () => {
    const log = [
      `${ts('14:30:01')}ccstate.go:999: SetState(106)`,
      `${ts('14:30:05')}app.go:777: will try again in 60s`,
      `${ts('14:31:01')}ccstate.go:999: SetState(111)`,
    ]
    const result = parseMcdLog(log)
    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0].retryIntervalSeconds).toBe(60)
    expect(result.cycles[1].states).toEqual([111])
  })

  it('classifies keep-alive timeout using message text even when line number changes', () => {
    const log = [
      `${ts('14:30:02')}app.go:42: ipc keep-alive timeout; last received "62s" ago`,
      JMD_KILLED,
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBe('keep-alive-timeout')
  })

  it('classifies cloud disconnect using message text even when line numbers change', () => {
    const log = [
      `${ts('14:30:02')}ipc_server.go:999: stopping ipc server`,
      `${ts('14:30:02')}app.go:5: ctx canceled; exiting sendCloudMsgs`,
      JMD_KILLED,
      retryLine(1),
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].killPath).toBe('cloud-disconnect')
  })

  it('parses SetState and retry interval with extra spacing', () => {
    const log = [
      `${ts('14:30:01')}ccstate.go:243: SetState( 106 )`,
      `${ts('14:30:05')}app.go:1040: will try again in   60s`,
    ]
    const result = parseMcdLog(log)
    expect(result.cycles[0].states).toEqual([106])
    expect(result.cycles[0].retryIntervalSeconds).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// Shared fixture corpus
// ---------------------------------------------------------------------------

describe('shared fixture corpus', () => {
  it('parses the keep-alive timeout fixture', () => {
    const result = parseMcdLog(MCD_FIXTURE_KEEPALIVE_TIMEOUT.log)
    expect(result.cycles[0].killPath).toBe('keep-alive-timeout')
    expect(result.cycles[0].disconnectReason?.event_sent).toBe(true)
  })

  it('parses the cloud-disconnect fixture', () => {
    const result = parseMcdLog(MCD_FIXTURE_CLOUD_DISCONNECT.log)
    expect(result.cycles[0].killPath).toBe('cloud-disconnect')
  })

  it('parses the cached-IP recovery fixture as 106 to 111', () => {
    const result = parseMcdLog(MCD_FIXTURE_CACHED_IP_RECOVERY.log)
    expect(result.cycles.map((cycle) => cycle.states[0])).toEqual([106, 111])
  })
})
