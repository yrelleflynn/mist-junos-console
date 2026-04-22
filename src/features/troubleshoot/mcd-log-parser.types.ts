/**
 * mcd-log-parser.types.ts
 *
 * Public types for the mcd log parser.
 *
 * These types are intentionally decoupled from the rest of the app so the
 * parser can be tested in isolation and later consumed by any formatter or
 * check result adapter without modification.
 */

// ---------------------------------------------------------------------------
// Kill path
// ---------------------------------------------------------------------------

/**
 * Why jmd was killed in a given retry cycle.
 *
 * 'keep-alive-timeout'  — mcd stopped receiving IPC heartbeats from jmd and
 *                         pulled the trigger. Indicates jmd is hung or dead.
 *                         Signature: app.go:865 present.
 *
 * 'cloud-disconnect'    — The Mist WebSocket connection dropped. mcd tore down
 *                         its IPC server and killed jmd as part of the shutdown
 *                         sequence. Recovery typically takes ~10 seconds.
 *                         Signature: ipc_server.go:161 and/or app.go:1110 present.
 *
 * null                  — Neither pattern is present (no kill in this cycle),
 *                         or both patterns are present (ambiguous — unexpected
 *                         in practice but handled defensively).
 */
export type McdKillPath = 'keep-alive-timeout' | 'cloud-disconnect' | null

// ---------------------------------------------------------------------------
// Disconnect reason
// ---------------------------------------------------------------------------

/**
 * The structured disconnect reason written by mcd to ccstate.go:511.
 *
 * event_sent reflects the best known state at parse time:
 *   - false  → mcd has stored the reason locally but has not yet confirmed
 *              delivery to Mist (switch hasn't reconnected to report it)
 *   - true   → a ccstate.go:574 line in the same cycle confirmed delivery
 */
export interface McdDisconnectReason {
  /** ISO-like timestamp embedded in the JSON — authoritative moment of the state change */
  timestamp: string
  /** JMA state code at the time of disconnect */
  cc_state: number
  /** Human-readable disconnect reason string from mcd */
  reason: string
  /** Whether Mist has received this disconnect reason */
  event_sent: boolean
}

// ---------------------------------------------------------------------------
// Parsed cycle
// ---------------------------------------------------------------------------

/**
 * One retry cycle as extracted from the mcd log.
 *
 * A cycle spans from the start of the file (or the previous cycle boundary)
 * up to and including an app.go:1040 "will try again in Xs" line. Trailing
 * lines that don't end with a cycle boundary form one final incomplete cycle.
 */
export interface McdParsedCycle {
  /** 1-based cycle index in the order seen in the log */
  cycleNumber: number
  /** JMA state codes from SetState() calls, in the order they appeared */
  states: number[]
  /** How jmd was killed in this cycle, if at all */
  killPath: McdKillPath
  /**
   * The disconnect reason recorded by mcd in this cycle.
   * null if no ccstate.go:511 line was present.
   */
  disconnectReason: McdDisconnectReason | null
  /**
   * Retry interval extracted from app.go:1040 ("will try again in Xs").
   * null for the trailing incomplete cycle (no cycle boundary line).
   * 1s typically means mcd expects quick recovery; 60s means longer failure mode.
   */
  retryIntervalSeconds: number | null
  /** Signal lines that belong to this cycle, in order */
  rawLines: string[]
}

// ---------------------------------------------------------------------------
// Parser output
// ---------------------------------------------------------------------------

/**
 * Complete parsed output for a mcd log input.
 */
export interface McdParsedLog {
  /** All extracted cycles, in order */
  cycles: McdParsedCycle[]
  /** Total raw lines processed (including noise) */
  totalLines: number
  /** Lines that matched at least one signal pattern */
  signalLines: number
}

// ---------------------------------------------------------------------------
// State code reference (for formatter use)
// ---------------------------------------------------------------------------

/**
 * Human-readable names for known JMA state codes.
 * Exported for use by formatters — not used by the parser itself.
 */
export const MCD_STATE_NAMES: Readonly<Record<number, string>> = {
  101: 'BootComplete',
  102: 'NoIPAddress',
  103: 'NoDefaultGateway',
  104: 'DefaultGatewayUnreachable',
  105: 'NoDNS',
  106: 'DNSLookupFailed',
  107: 'ConnectionRequestSent',
  108: 'CloudUnreachable',
  109: 'CloudAuthFailure',
  110: 'ServiceDown',
  111: 'Connected',
  113: 'NoDNSResponse',
  114: 'EmptyDNSResponse',
  151: 'DuplicateIPAddress',
} as const
