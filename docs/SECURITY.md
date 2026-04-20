# Security Posture

## Purpose

Describe the current security model honestly, including what is already in
place and what should be added before broader production rollout.

## Security Principles

- the operator owns the live console session
- remote access is explicit and opt-in
- high-risk actions remain operator-gated
- Mist API access should move server-side wherever possible
- sensitive console data should be handled conservatively

## Current Security Controls

### 1. Operator-owned console session

- the operator browser is the source of Web Serial access
- no remote participant owns the serial device directly
- the operator can disconnect or disable sharing

### 2. Explicit remote-session enablement

- support access is not on by default
- the operator must explicitly enable remote session sharing
- when the operator disconnects, the support session ends visibly

### 3. Bounded action model

The product already avoids arbitrary remote command execution in several paths:

- troubleshooting checks are bounded
- recovery actions are bounded
- MCP actions are bounded
- direct commit/rollback remains operator-gated

### 4. Mist API via backend proxy

- the backend proxies Mist API requests
- this reduces direct browser-to-Mist cross-origin complexity
- it creates a cleaner path toward backend-owned credentials in a hosted model

### 5. Session masking and future logging controls

Relevant supporting docs:

- [docs/SESSION-MASKING-POLICY.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-MASKING-POLICY.md)
- [docs/SESSION-EVENT-SCHEMA.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03%20Mist%20Docs/07%20Projects/mist-junos-console/docs/SESSION-EVENT-SCHEMA.md)

These define the intended posture for:

- masking sensitive values
- event attribution
- future transcript handling

## Current Security Limitations

These are important and should be stated clearly.

### 1. Remote session IDs are currently shared secrets

- the support flow currently relies on possession of the session ID
- there is not yet SSO or stronger participant authentication
- this is acceptable for demo and controlled environments, not ideal for broad
  internet-scale rollout

### 2. Mist token handling is still transitional

- the current prototype still allows browser-entered Mist API details
- long term, the preferred model is backend-owned trusted Mist auth inherited
  from the Mist platform

### 3. Web Serial remains browser-local

- this is by design and is a good security boundary
- but it also means the operator’s browser remains a critical trust anchor

## Secure Deployment Assumptions For Immediate Customer Use

The product is suitable for immediate customer use in a controlled deployment
model where:

- the operator is physically present at the switch
- the browser session is operator-owned
- remote support is explicitly enabled by the operator
- the deployment environment is trusted or access-controlled
- high-risk state changes remain operator-approved

This is the intended meaning of "production-ready" for the hackathon scope:

- usable now
- bounded now
- honest about the remaining hardening items

## Required Hardening Before Wider Rollout

Before exposing this more broadly, the next security improvements should be:

1. SSO-backed support authentication
2. stronger participant roles and permissions
3. short-lived support/session tokens instead of session-ID-only access
4. transcript retention and masking enforcement
5. backend-owned Mist auth in a Mist-native launch model

## Bottom Line

The current product is secure enough for controlled customer use and demo use
because:

- the operator owns the session
- risky actions are bounded or operator-gated
- remote access is explicit
- the trust boundaries are documented

It is not presented as “fully hardened for anonymous public internet access”
yet, and the documentation says so clearly.
