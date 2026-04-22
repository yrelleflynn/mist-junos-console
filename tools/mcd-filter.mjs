#!/usr/bin/env node
/**
 * mcd-filter.mjs
 *
 * Filters a Juniper Mist Agent (mcd) log file down to diagnostic signal lines,
 * grouped into retry cycles. Strips the high-volume ipc_server.go polling noise.
 *
 * Usage:
 *   node tools/mcd-filter.mjs <path-to-mcd.log>
 *   cat /var/log/mcd | node tools/mcd-filter.mjs
 */

import { createReadStream } from 'fs'
import { createInterface } from 'readline'

// --- Patterns that carry diagnostic signal ---
const SIGNAL_PATTERNS = [
  /ccstate\.go:/,          // State machine: IP, gateway, DNS, SetState()
  /connect\.go:/,          // TCP connection attempts and failures
  /app\.go:1040/,          // "will try again in Xs" — marks end of a retry cycle
  /app\.go:865/,           // ipc keep-alive timeout — jmd stopped responding
  /app\.go:1110/,          // ctx canceled; exiting sendCloudMsgs — cloud disconnect
  /ipc_server\.go:161/,    // stopping ipc server — cloud WebSocket dropped
  /monitor\.go:238/,       // killing jmd
  /monitor\.go:211/,       // started jmd process
]

// Marks the end of a retry cycle — use to split into groups
const CYCLE_BOUNDARY = /app\.go:1040/

// Disconnect reason JSON embedded in ccstate.go:511 (stored) and ccstate.go:574 (sent)
const DISCONNECT_REASON        = /updated disconnect reason: ({.*})/
const DISCONNECT_REASON_SENT   = /updated disconnect reason event sent status: ({.*})/

// SetState() call — captures the state code
const SET_STATE = /SetState\((\d+)\)/

// Human-readable names for known JMA state codes
const STATE_NAMES = {
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
}

function stateName(code) {
  return STATE_NAMES[code] ? `${code} (${STATE_NAMES[code]})` : String(code)
}

function extractStates(lines) {
  const states = []
  for (const line of lines) {
    const m = line.match(SET_STATE)
    if (m) states.push(parseInt(m[1], 10))
  }
  return states
}

function formatTransition(states) {
  if (states.length === 0) return 'no SetState'
  return states.map(stateName).join(' → ')
}

function isSignal(line) {
  return SIGNAL_PATTERNS.some(p => p.test(line))
}

function formatEventSent(sent) {
  return sent ? '✓ true  (sent to Mist)' : '⚠ false  ← NOT YET SENT TO MIST'
}

function formatCycle(lines, cycleNumber, states) {
  const out = []
  const label = formatTransition(states)
  out.push(`\n${'─'.repeat(60)}`)
  out.push(`  Cycle ${cycleNumber}  —  ${label}`)
  out.push('─'.repeat(60))

  for (const line of lines) {
    // ccstate.go:574 — disconnect reason confirmed sent to Mist
    const sentMatch = line.match(DISCONNECT_REASON_SENT)
    if (sentMatch) {
      try {
        const parsed = JSON.parse(sentMatch[1])
        out.push('  ' + line.split('ccstate.go')[0] + 'ccstate.go:574: updated disconnect reason event sent status:')
        out.push(`    timestamp : ${parsed.timestamp}`)
        out.push(`    cc_state  : ${parsed.cc_state}`)
        out.push(`    reason    : ${parsed.reason}`)
        out.push(`    event_sent: ${formatEventSent(parsed.event_sent)}`)
        continue
      } catch {
        // fall through to raw line
      }
    }

    // ccstate.go:511 — disconnect reason stored (may not yet be sent)
    const jsonMatch = line.match(DISCONNECT_REASON)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        out.push('  ' + line.split('ccstate.go')[0] + 'ccstate.go:511: updated disconnect reason:')
        out.push(`    timestamp : ${parsed.timestamp}`)
        out.push(`    cc_state  : ${parsed.cc_state}`)
        out.push(`    reason    : ${parsed.reason}`)
        out.push(`    event_sent: ${formatEventSent(parsed.event_sent)}`)
        continue
      } catch {
        // fall through to raw line
      }
    }

    out.push('  ' + line.trim())
  }
  return out.join('\n')
}

async function processStream(stream) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let currentCycle = []
  let cycleNumber = 0
  let totalLines = 0
  let signalLines = 0

  // Track unique transitions across the whole file: "A → B" → count
  const transitionCounts = new Map()

  // Disconnect reason timeline: one entry per ccstate.go:511, updated when 574 confirms sent
  // { jsonTimestamp, ccState, reason, storedAt, sentAt|null }
  const disconnectTimeline = []

  function recordTransition(states) {
    if (states.length === 0) return
    const key = states.map(s => STATE_NAMES[s] ? `${s}(${STATE_NAMES[s]})` : s).join(' → ')
    transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1)
  }

  function extractLogTimestamp(line) {
    const m = line.match(/\[mcd\] (\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/)
    return m ? m[1] : null
  }

  function trackDisconnectReason(line) {
    // ccstate.go:511 — reason stored
    const storedMatch = line.match(DISCONNECT_REASON)
    if (storedMatch) {
      try {
        const parsed = JSON.parse(storedMatch[1])
        disconnectTimeline.push({
          jsonTimestamp: parsed.timestamp,
          ccState: parsed.cc_state,
          reason: parsed.reason,
          storedAt: extractLogTimestamp(line),
          sentAt: parsed.event_sent ? extractLogTimestamp(line) : null,
        })
      } catch {}
      return
    }

    // ccstate.go:574 — sent to Mist confirmed; find matching entry and update
    const sentMatch = line.match(DISCONNECT_REASON_SENT)
    if (sentMatch) {
      try {
        const parsed = JSON.parse(sentMatch[1])
        if (parsed.event_sent) {
          // Match by jsonTimestamp — find the most recent unsent entry with this timestamp
          const entry = [...disconnectTimeline]
            .reverse()
            .find(e => e.jsonTimestamp === parsed.timestamp && !e.sentAt)
          if (entry) entry.sentAt = extractLogTimestamp(line)
        }
      } catch {}
    }
  }

  function flushCycle() {
    cycleNumber++
    const states = extractStates(currentCycle)
    console.log(formatCycle(currentCycle, cycleNumber, states))
    recordTransition(states)
    currentCycle = []
  }

  for await (const line of rl) {
    totalLines++
    trackDisconnectReason(line)
    if (!isSignal(line)) continue

    signalLines++
    currentCycle.push(line)

    if (CYCLE_BOUNDARY.test(line)) {
      flushCycle()
    }
  }

  // Print any trailing lines that didn't end with a cycle boundary
  if (currentCycle.length > 0) {
    flushCycle()
  }

  // --- Disconnect reason timeline ---
  if (disconnectTimeline.length > 0) {
    console.log('\n' + '═'.repeat(60))
    console.log('  DISCONNECT REASON TIMELINE')
    console.log('═'.repeat(60))
    for (const e of disconnectTimeline) {
      const state = STATE_NAMES[e.ccState] ? `${e.ccState}(${STATE_NAMES[e.ccState]})` : e.ccState
      if (e.sentAt) {
        // Calculate seconds between stored and sent
        const t1 = new Date(e.storedAt.replace(/\//g, '-').replace(' ', 'T'))
        const t2 = new Date(e.sentAt.replace(/\//g, '-').replace(' ', 'T'))
        const secs = Math.round((t2 - t1) / 1000)
        console.log(`  ${e.jsonTimestamp}  ${state.padEnd(30)}  ✓ sent  (+${secs}s)`)
      } else {
        console.log(`  ${e.jsonTimestamp}  ${state.padEnd(30)}  ⚠ NOT SENT`)
      }
    }
    console.log('═'.repeat(60))
  }

  // --- Transition summary ---
  console.log('\n' + '═'.repeat(60))
  console.log('  STATE TRANSITION SUMMARY')
  console.log('═'.repeat(60))
  if (transitionCounts.size === 0) {
    console.log('  (no SetState calls found)')
  } else {
    const sorted = [...transitionCounts.entries()].sort((a, b) => b[1] - a[1])
    for (const [transition, count] of sorted) {
      const bar = '█'.repeat(Math.min(count, 20))
      console.log(`  ${String(count).padStart(4)}x  ${bar}  ${transition}`)
    }
  }
  console.log('═'.repeat(60))
  console.log(`  ${cycleNumber} cycle(s) | ${signalLines} signal lines from ${totalLines} total`)
  console.log('═'.repeat(60))
}

// --- Entry point ---
const [,, filePath] = process.argv

if (filePath) {
  const stream = createReadStream(filePath)
  stream.on('error', err => {
    console.error(`Error reading file: ${err.message}`)
    process.exit(1)
  })
  processStream(stream)
} else if (!process.stdin.isTTY) {
  processStream(process.stdin)
} else {
  console.error('Usage: node tools/mcd-filter.mjs <path-to-mcd.log>')
  console.error('       cat mcd.log | node tools/mcd-filter.mjs')
  process.exit(1)
}
