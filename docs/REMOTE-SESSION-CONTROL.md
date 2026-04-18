# Remote Session Control

## Summary

The current remote support model allows an operator to share a live console
session with one or more remote participants. All participants can see the
same live switch output, and support participants can currently inject input
back into the operator console session.

This document proposes a lightweight control-handoff model so only one side can
type at a time while both sides retain live read-only visibility.

## Problem

The existing shared-input model is useful but loose:

- operator and support can both type
- simultaneous input can collide
- ownership is unclear during active troubleshooting
- the operator does not have an explicit, visible guarantee that they are in
  control

The same issue will matter even more if AI agents are later allowed to observe
or participate in the session.

## Goals

- preserve shared live console visibility
- ensure only one participant type can inject keystrokes at a time
- make control ownership visible to both sides
- keep the operator as the default owner of the session
- support future participant types such as AI agents without redesigning the
  session model later

## Current Implementation

### Current backend session model

The backend already tracks each support connection as a unique WebSocket member
inside the shared session.

Current shape in [`server/index.mjs`](../server/index.mjs):

- `sessions: Map<string, { members: { ws, role }[] }>`
- each session has:
  - exactly one operator
  - zero or more support members
- each support browser gets its own WebSocket connection
- support participants all join the same logical console session ID, but they
  are still separate tracked members in the backend

So if two support users join the same session ID:

- the backend is aware of both distinct support WebSocket members
- they are not collapsed into one backend connection
- they currently share the same role: `support`

### Current role model

Today there are only two participant roles:

- `operator`
- `support`

There is not yet any distinction between:

- human support
- AI agent participant

That distinction would need to be added explicitly in a future session model.

## Proposed Control Model

### Roles

Keep the current participant roles for now:

- `operator`
- `support`

Optionally extend later to:

- `support_human`
- `support_agent`

### Control states

Introduce a separate control token that is independent of visibility:

- `operator_in_control`
- `support_in_control`

Behavior:

- both sides always see the live console
- only the side in control can inject keystrokes
- the non-controlling side becomes read-only

## Default Behavior

- operator starts in control
- support joins as read-only
- support can request or take control
- operator can always take control back

For v1, direct take-control is acceptable.

Later, a stricter version could require operator approval before support or an
agent takes control.

## User Experience

### Operator UI

Show a compact status block such as:

- `Remote Session: Active`
- `Control: You`
- or `Control: Support`

Buttons:

- `Take Control`
- optionally `Release Control`

System banners:

- `Remote support took control`
- `You took control back`

### Support UI

Show matching status:

- `Remote Session: Active`
- `Control: Operator`
- or `Control: You`

Buttons:

- `Take Control`
- optionally `Return Control`

## Backend Changes

Extend each session with controller metadata.

Suggested shape:

```js
{
  members: [
    { ws, role: 'operator' | 'support', participantType?: 'human' | 'agent' }
  ],
  controller: 'operator' | 'support',
  lastControllerChangeAt: '2026-04-18T12:34:56Z',
  lastControllerChangeBy: 'operator' | 'support'
}
```

### Enforcement

- input from the non-controlling side is ignored
- control changes are broadcast to all session members
- operator remains authoritative and can always reclaim control

## Suggested WebSocket Events

### Client → server

`take_control`

```json
{
  "type": "take_control",
  "actor": "operator"
}
```

or

```json
{
  "type": "take_control",
  "actor": "support"
}
```

### Server → clients

`control_changed`

```json
{
  "type": "control_changed",
  "controller": "operator"
}
```

`session_state`

```json
{
  "type": "session_state",
  "controller": "operator"
}
```

This can be sent:

- immediately after join
- after any control change
- after disconnect cleanup if controller ownership changes

## Multiple Support Connections

Multiple support connections are acceptable and fit both:

- current human support collaboration
- future agent participation

However, once there are multiple support participants, control semantics need to
be explicit.

Recommended first-pass rule:

- all support connections share the `support` side of the control token
- if support is in control, any support participant can type
- if operator is in control, all support participants are read-only

Recommended future refinement:

- identify support participants individually
- show who currently holds control
- optionally distinguish:
  - `support_human`
  - `support_agent`

## Human Support vs Agent Participants

The current implementation does not distinguish between human support and agent
connections.

That distinction is worth adding later because the policy may differ:

- human support may be allowed to request control interactively
- agent participants may be restricted to read-only unless the operator grants
  explicit temporary control

Recommended future participant metadata:

```js
{
  role: 'support',
  participantType: 'human' | 'agent',
  displayName: 'Support Engineer' | 'Recovery Agent',
  id: 'unique-participant-id'
}
```

This would let the UI say:

- `Support Engineer is in control`
- `Recovery Agent is observing`

## Acceptance Criteria

1. Operator starts in control by default.
2. Support joins read-only.
3. Only the controlling side’s keystrokes are forwarded to the serial session.
4. Both sides can see who is currently in control.
5. Operator can always take control back immediately.
6. Control changes are visible in both UIs and in the terminal as banners.
7. Existing read-only live console visibility remains uninterrupted.

## Deferred

- approval-based control requests
- per-support-user control identity
- agent-specific control policy
- audit trail UI for control handoff history
- inactivity timeout / auto-return control

## Priority

High-value backlog item, but not required for the hackathon demo.

It improves:

- safety
- usability
- trust
- readiness for future agent-assisted workflows
