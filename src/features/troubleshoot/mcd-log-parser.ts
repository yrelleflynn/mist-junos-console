/**
 * mcd-log-parser.ts
 *
 * Pure TypeScript parser for Juniper Mist Agent (mcd) log files.
 *
 * Accepts raw log text or a pre-split array of lines. Filters high-signal
 * lines, groups them into retry cycles, and extracts structured state machine
 * data from each cycle.
 *
 * This module is intentionally dependency-free: no file I/O, no app services,
 * no DOM. Feed it lines from any source (shell output, MCP tool, test fixture)
 * and get structured output back.
 *
 * Design notes:
 * - Signal patterns match on text content, not hard-coded source line numbers.
 *   Line numbers in ccstate.go will change across JMA versions; the log text
 *   content is stable.
 * - Cycle boundary is app.go:1040 ("will try again in Xs"). Every complete
 *   retry cycle ends with this line. Trailing lines that don't reach a
 *   boundary form one final incomplete cycle.
 * - Kill path classification is mutually exclusive by design. If both markers
 *   are present in a cycle (unexpected in practice), the result is null to
 *   avoid misdiagnosis.
 *
 * Reference: tools/mcd-filter.mjs (prototype), docs/MCD-LOG-PARSER-SCOPE.md
 */

import type {
  McdDisconnectReason,
  McdKillPath,
  McdParsedCycle,
  McdParsedLog,
} from './mcd-log-parser.types'

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

/**
 * Lines matching any of these patterns carry diagnostic signal and are
 * included in cycle output. All other lines are noise and are discarded.
 *
 * Patterns are deliberately broad (matching the filename prefix) so the
 * parser captures all lines from each relevant source file, regardless of
 * which internal source line number they originate from.
 */
const SIGNAL_PATTERNS: readonly RegExp[] = [
  /ccstate\.go:/,                           // state machine: IP, gateway, DNS, SetState()
  /connect\.go:/,                           // TCP connection attempts and failures, cached IP
  /will try again in\s+\d+s/,               // retry boundary / interval
  /ipc keep-alive timeout/,                 // jmd unresponsive
  /ctx canceled;\s+exiting sendCloudMsgs/,  // cloud disconnect path
  /stopping ipc server/,                    // cloud WebSocket dropped
  /killing monitored process/,              // jmd kill
  /started jmd/,                            // jmd restart
]

// ---------------------------------------------------------------------------
// Extraction patterns
// ---------------------------------------------------------------------------

/** Cycle boundary — marks the end of a complete retry cycle */
const CYCLE_BOUNDARY = /will try again in\s+\d+s/

/** JMA state transition — captures the state code */
const SET_STATE = /SetState\s*\(\s*(\d+)\s*\)/

/** Retry wait interval from the cycle boundary line */
const RETRY_INTERVAL = /will try again in\s+(\d+)s/

/**
 * ccstate.go:511 — disconnect reason stored locally by mcd.
 * JSON shape: { timestamp, cc_state, reason, event_sent }
 *
 * Note: this pattern must NOT match the ccstate.go:574 line. It doesn't,
 * because 574 reads "updated disconnect reason event sent status:" (with
 * "event sent status" between "reason" and the colon), whereas 511 reads
 * "updated disconnect reason:" directly.
 */
const DISCONNECT_REASON_511 = /updated disconnect reason:\s+(\{.*\})/

/**
 * ccstate.go:574 — confirms the stored disconnect reason was sent to Mist.
 * JSON shape is the same as 511 but with event_sent: true when confirmed.
 */
const DISCONNECT_REASON_574 = /updated disconnect reason event sent status:\s+(\{.*\})/

/** keep-alive-timeout kill path marker */
const KILL_KEEPALIVE = /ipc keep-alive timeout/

/** cloud-disconnect kill path markers (either is sufficient) */
const KILL_CLOUD_PRIMARY = /stopping ipc server/
const KILL_CLOUD_SECONDARY = /ctx canceled;\s+exiting sendCloudMsgs/

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isSignalLine(line: string): boolean {
  return SIGNAL_PATTERNS.some(p => p.test(line))
}

function extractStates(lines: readonly string[]): number[] {
  const states: number[] = []
  for (const line of lines) {
    const m = line.match(SET_STATE)
    if (m) states.push(parseInt(m[1], 10))
  }
  return states
}

function classifyKillPath(lines: readonly string[]): McdKillPath {
  const hasKeepAlive = lines.some(l => KILL_KEEPALIVE.test(l))
  const hasCloudDisconnect = lines.some(
    l => KILL_CLOUD_PRIMARY.test(l) || KILL_CLOUD_SECONDARY.test(l),
  )

  // Both present is unexpected in practice. Return null rather than guess.
  if (hasKeepAlive && hasCloudDisconnect) return null
  if (hasKeepAlive) return 'keep-alive-timeout'
  if (hasCloudDisconnect) return 'cloud-disconnect'
  return null
}

function extractRetryInterval(lines: readonly string[]): number | null {
  for (const line of lines) {
    const m = line.match(RETRY_INTERVAL)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

/**
 * Shape we expect from ccstate.go:511 and ccstate.go:574 JSON payloads.
 * Fields are optional so we can validate presence before trusting them.
 */
interface RawDisconnectJson {
  timestamp?: unknown
  cc_state?: unknown
  reason?: unknown
  event_sent?: unknown
}

function isValidDisconnectJson(
  v: RawDisconnectJson,
): v is { timestamp: string; cc_state: number; reason: string; event_sent: boolean } {
  return (
    typeof v.timestamp === 'string' &&
    typeof v.cc_state === 'number' &&
    typeof v.reason === 'string' &&
    typeof v.event_sent === 'boolean'
  )
}

function timestampsEquivalent(a: string, b: string): boolean {
  if (a === b) return true
  const aMs = Date.parse(a)
  const bMs = Date.parse(b)
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return false
  return aMs === bMs
}

/**
 * Parse the disconnect reason from cycle lines.
 *
 * Strategy:
 * 1. Collect all ccstate.go:511 entries in the cycle.
 * 2. Use the last one as the authoritative disconnect reason for this cycle.
 *    (Multiple 511 entries can appear in an oscillating cycle; the last one
 *    reflects the state closest to the cycle boundary.)
 * 3. Scan all ccstate.go:574 entries. If one has event_sent:true and its
 *    embedded timestamp matches the chosen 511 entry, update event_sent to true.
 *
 * This two-pass approach handles any ordering of 511 and 574 lines within
 * the cycle window.
 */
function parseDisconnectReason(lines: readonly string[]): McdDisconnectReason | null {
  // --- Pass 1: collect all 511 entries ---
  const entries: McdDisconnectReason[] = []
  for (const line of lines) {
    const m = line.match(DISCONNECT_REASON_511)
    if (!m) continue
    try {
      const raw: RawDisconnectJson = JSON.parse(m[1]) as RawDisconnectJson
      if (isValidDisconnectJson(raw)) {
        entries.push({
          timestamp: raw.timestamp,
          cc_state: raw.cc_state,
          reason: raw.reason,
          event_sent: raw.event_sent,
        })
      }
    } catch {
      // Malformed JSON — skip this line
    }
  }

  if (entries.length === 0) return null

  // Use the last 511 entry as the primary result
  const result: McdDisconnectReason = { ...entries[entries.length - 1] }

  // --- Pass 2: refine event_sent from 574 lines ---
  if (!result.event_sent) {
    for (const line of lines) {
      const m = line.match(DISCONNECT_REASON_574)
      if (!m) continue
      try {
        const raw: RawDisconnectJson = JSON.parse(m[1]) as RawDisconnectJson
        if (
          isValidDisconnectJson(raw) &&
          raw.event_sent === true &&
          timestampsEquivalent(raw.timestamp, result.timestamp)
        ) {
          result.event_sent = true
          break
        }
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  return result
}

function buildCycle(signalLines: string[], cycleNumber: number): McdParsedCycle {
  return {
    cycleNumber,
    states: extractStates(signalLines),
    killPath: classifyKillPath(signalLines),
    disconnectReason: parseDisconnectReason(signalLines),
    retryIntervalSeconds: extractRetryInterval(signalLines),
    rawLines: signalLines,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a mcd log into structured cycle data.
 *
 * @param input - Raw log text (newline-separated) or a pre-split array of lines.
 *                Accepts output from `show log mcd`, shell grep, or any other
 *                source — the parser does its own signal filtering.
 *
 * @returns Structured log data including all parsed cycles, total line counts,
 *          and signal line counts.
 */
export function parseMcdLog(input: string | string[]): McdParsedLog {
  const lines = Array.isArray(input) ? input : input.split('\n')

  const cycles: McdParsedCycle[] = []
  let currentCycleLines: string[] = []
  let cycleNumber = 0
  let totalLines = 0
  let signalLines = 0

  for (const line of lines) {
    totalLines++

    if (!isSignalLine(line)) continue

    signalLines++
    currentCycleLines.push(line)

    if (CYCLE_BOUNDARY.test(line)) {
      cycles.push(buildCycle(currentCycleLines, ++cycleNumber))
      currentCycleLines = []
    }
  }

  // Trailing signal lines that didn't reach a cycle boundary form one final
  // incomplete cycle. This is the normal case for Query B (current state),
  // where we tail the live log and the switch may be mid-retry.
  if (currentCycleLines.length > 0) {
    cycles.push(buildCycle(currentCycleLines, ++cycleNumber))
  }

  return { cycles, totalLines, signalLines }
}
