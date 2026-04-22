# Prototype To Production Architecture

## Purpose

This document explains how the current `junos-console` prototype could evolve
into a production-grade service suitable for large-scale customer deployment and,
potentially, integration into Mist's service architecture.

It is not claiming that the current backend already meets those scale targets.
Instead, it shows:

- what the current backend does well
- where its scaling limits are today
- how the same product model could be adapted into a multi-service design
- what the most realistic migration path would be

Related docs:

- [docs/PRD.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/PRD.md)
- [docs/BACKEND-MCP-POC.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/BACKEND-MCP-POC.md)
- [docs/AI-AGENT-INTEGRATION.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/AI-AGENT-INTEGRATION.md)
- [docs/SECURITY.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SECURITY.md)

## Current Prototype Backend

Today, the backend in [server/index.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/index.mjs:1)
combines several concerns in one Node process:

- WebSocket session hub for operator/support console sharing
- Mist API proxy
- MCP session-state store
- MCP action queue / relay

This is a good prototype shape because it is:

- simple to run locally
- easy to debug
- enough to prove the user workflow
- enough to validate bounded agent actions and UI orchestration

But it is not a large-scale production shape yet.

## What Scales Well Already

The product model itself is strong and is compatible with a larger architecture:

- thin browser client
- backend-managed session orchestration
- bounded operator-approved actions
- clear separation between live console transport and higher-level analysis
- optional AI analysis as a read-only or approval-gated layer

Those ideas are worth keeping.

## Capability Ownership Principle

Production architecture should make capability ownership clearer, not blurrier.

The system should prefer the authoritative source of a capability rather than
rebuilding equivalent logic in multiple layers.

Examples:

- device-native diagnostics should come from the device-native source when that
  source already exists in usable form
  for example, parsing mcd output rather than recreating the same check logic
  as separate app-side tests
- Mist control-plane context should come from Mist-owned integrations rather
  than duplicated app-local approximations
- bounded agent/MCP tools should be exposed once through the right backend
  boundary, not reimplemented in parallel surfaces with overlapping semantics

This matters for more than elegance:

- fewer duplicated checks and integrations means less operator clutter
- fewer parallel implementations means less drift and fragility
- service boundaries become easier to reason about and secure
- future production ownership is clearer

## Current Scaling Limits

The main issue is not the workflow design. It is that the current backend keeps
runtime state in process memory.

Examples in [server/index.mjs](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/server/index.mjs:1):

- `sessions`
- `mcpSessionStates`
- `mcpActionQueues`
- `mcpActions`

That means:

- one process owns active session state
- a restart loses live session and action state
- horizontal scaling is difficult
- durable retries and audit trails are limited
- tenancy and authorization boundaries are lightweight

This is acceptable for a hackathon prototype and small controlled deployments,
but not ideal for thousands of customer orgs and concurrent support sessions.

## What A Mist-Scale Version Would Need

### 1. Stateless Session Gateway

The browser-facing WebSocket/API edge should move toward stateless workers
behind a load balancer.

Responsibilities:

- accept browser/operator/support connections
- authenticate requests
- publish serial and control events onto a shared bus
- subscribe to session events for the correct active session

Likely backing services:

- load balancer / ingress
- Redis or similar for pub/sub and hot session state

### 2. Session Orchestrator

A dedicated service should own the lifecycle of each remote-console session.

Responsibilities:

- create and lease session IDs
- track operator/support membership
- enforce session ownership and expiry
- handle reconnect and takeover rules
- keep durable session metadata

This service becomes the source of truth for:

- who owns the session
- which device it is tied to
- whether agent access is allowed
- whether the session is healthy

### 3. Durable Action / Workflow Service

The current in-memory action queue should become a durable workflow service.

Responsibilities:

- enqueue bounded actions
- track claim / running / completed / failed states
- enforce retries and timeouts
- keep an audit trail
- expose action history to operators and support tools

Likely backing services:

- queue or job system
- durable database for action records

### 4. Mist Integration Service

The Mist API proxy should become its own bounded integration service.

Responsibilities:

- call Mist APIs with service-side credentials or scoped delegated auth
- normalize common responses
- apply caching and rate limiting
- isolate Mist failures from the console session path
- expose shared Mist-side capabilities so product features and agent tooling do
  not each invent separate integration paths for the same data

This is especially important because:

- Mist API calls are control-plane operations
- they have different scaling and retry characteristics than live console relay

### 5. AI / Analysis Service

The AI analysis layer should be separate from the live transport path.

Responsibilities:

- consume structured session, check, log, and Mist context
- produce analysis and recommendations
- optionally suggest bounded actions
- stay isolated from the live serial transport and session gateway
- reuse existing authoritative backend capabilities rather than duplicating
  Mist integration or device-diagnostic collection logic inside the AI layer

This is a good fit for independent scaling because AI workloads are:

- bursty
- cost-sensitive
- slower than live session traffic

### 6. Durable Stores

A production version would need storage separation by access pattern.

Suggested shape:

- Redis:
  - hot session presence
  - pub/sub
  - short-lived coordination state
- relational store:
  - durable sessions
  - action records
  - audit logs
  - tenant scoping metadata
- object storage:
  - optional transcript bundles
  - exported evidence packages
  - large artifacts

## Candidate Microservice Shape

A reasonable target architecture inside a Mist-style platform would look like:

```text
Browser operator / support UI
        │
        ▼
Session Gateway
        │
        ├── Session Orchestrator
        ├── Action / Workflow Service
        ├── Mist Integration Service
        ├── AI / Analysis Service
        └── Observability + Audit pipeline
```

This is not proposing an explosion of tiny services for its own sake. It is
just separating the main runtime concerns:

- live session transport
- durable session ownership/state
- bounded workflow execution
- Mist control-plane integration
- AI reasoning

It should also avoid duplicating the same concern across services. A Mist-owned
capability should stay Mist-owned. A device-native diagnostic should stay
device-native. The application layer should orchestrate and interpret those
capabilities, not rebuild them unnecessarily.

## How This Could Fit Into Mist Architecture

Yes, this concept could be adapted into Mist architecture.

The most natural fit would be:

- launched from Mist with inherited org/site/device context
- authenticated using Mist identity and RBAC
- backed by Mist-side service credentials for Mist API access
- exposed as a remote-console and recovery workflow service

That would improve several things immediately:

- no separate manual Mist API token entry for end customers
- much stronger tenant scoping
- cleaner org/site/device context propagation
- better auditability
- easier correlation with Mist events, last-seen data, and inventory

In that model, `junos-console` becomes less of a standalone tool and more of a:

- remote serial access surface
- bounded recovery workflow runner
- optional AI troubleshooting surface

inside the larger Mist operational environment.

## Security And Multi-Tenancy Considerations

At production scale, the main required upgrades are:

- strong tenant-scoped authentication
- Mist-native RBAC integration
- durable audit trails for actions
- action approval and role enforcement
- session ownership and support-access policy
- secret handling moved fully server-side

The current prototype already points in the right direction by keeping:

- high-risk actions bounded
- agent actions relayed instead of directly executing arbitrary CLI
- remote access opt-in

But large-scale rollout would require those controls to be enforced by platform
services rather than only local session conventions.

## Observability Requirements

A production rollout would need real observability from the start.

Key metrics:

- active sessions
- connected operators/support viewers
- session duration
- WebSocket disconnect/reconnect rate
- Mist proxy latency and error rate
- action queue depth
- action success/failure/timeout rates
- AI analysis latency and token/cost metrics

Without this, supporting thousands of customers would be very difficult even if
the code were otherwise split into services.

## Migration Path

The most realistic path is incremental rather than a rewrite.

### Phase 1: Harden The Current Backend

- keep the current user workflow
- move session and action state out of process
- add durable action records
- add better auth and audit coverage

### Phase 2: Split Core Concerns

- separate live session gateway from Mist proxy
- separate action/workflow execution from browser session handling
- keep the UI mostly unchanged

### Phase 3: Platform Integration

- launch from Mist context
- replace manual customer token entry with platform auth
- attach org/site/device metadata automatically

### Phase 4: AI Service Maturity

- run AI analysis as an independent service
- consume only structured, bounded context
- add approval-gated action suggestions

## Honest Positioning For Hackathon Judges

The right production-readiness story is:

- the current implementation is customer-usable now in controlled deployments
- the core workflow and product model scale conceptually
- the backend would need service decomposition and durable shared state for
  thousands of customers
- that migration path is straightforward and aligns well with a Mist-native
  architecture

In other words:

- **current code**: production-oriented prototype
- **current architecture direction**: sound
- **current backend scaling model**: intentionally simple, not final
- **future Mist microservice adaptation**: realistic and well aligned

## Bottom Line

This prototype is not pretending to already be a fully multi-tenant,
internet-scale control plane.

What it does show is:

- a product workflow that solves a real customer problem
- a bounded and secure action model
- a clean path from prototype backend to production service architecture
- a credible fit inside a Mist-style operational platform
