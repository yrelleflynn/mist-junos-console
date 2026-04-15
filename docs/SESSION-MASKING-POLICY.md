# Session Masking Policy

## Purpose

Define the first-pass masking rules for session logging so the product can store and export useful logs without exposing secrets.

## Core Rule

Mask sensitive values before persistence and before transcript rendering.

Raw unmasked session content should not be retained in backend storage in the normal path.

## Masking Stages

1. Capture event from UI, backend, or device stream
2. Classify event type and content
3. Apply masking rules
4. Persist masked structured event
5. Render transcript from masked event content

## Values That Must Be Masked

### Credentials

- Mist API tokens
- passwords entered at login prompts
- root passwords
- passphrases
- private keys if ever surfaced

### Sensitive config material

- encrypted passwords in Junos config
- SNMP community strings
- RADIUS and TACACS shared secrets
- pre-shared keys
- secrets embedded in `set` commands or config output

### Sensitive identifiers when appropriate

- session secrets
- one-time join tokens
- any future agent access tokens

## Default Masking Strategy

### Full replacement

Use full replacement when the original value has no troubleshooting value once revealed.

Examples:

- `Token abcdef123456` -> `Token [MASKED]`
- `Password:` user-entered value -> `[MASKED_PASSWORD]`

### Partial preservation

Use partial preservation when limited structure helps troubleshooting without exposing the full secret.

Examples:

- `$6$owTEXiuRcUETGKKw$...` -> `$6$[MASKED_HASH]`
- `radius-server secret VerySecret123` -> `radius-server secret [MASKED]`

## Event-Specific Guidance

### `terminal_tx`

- if the system is currently at a password prompt, mask the entire transmitted value
- if a typed command includes obvious secret-bearing keywords, mask the secret portion
- preserve the command keyword where possible for troubleshooting value

Examples:

- `set system root-authentication plain-text-password` -> preserve command, mask entered secret
- `set system services netconf ssh` -> no masking needed

### `terminal_rx`

- mask returned secret values from device output
- preserve surrounding config structure where possible

Examples:

- `set system root-authentication encrypted-password $6$abc...` -> `set system root-authentication encrypted-password [MASKED_HASH]`

### `mist_api_call`

- never store request auth tokens
- paths and operation names are safe to preserve unless they contain embedded secrets

### `mist_api_result`

- mask secret-bearing fields from returned payloads before persistence
- preserve non-sensitive metadata needed for troubleshooting

### `system_notice`, `test_result`, `config_sync_*`

- these should usually be safe to render directly
- if they include copied raw config or command output, run the same secret masking rules on embedded text

## Detection Heuristics

First-pass detection can combine:

- prompt state awareness such as `Password:`
- keyword matching such as:
  - `token`
  - `password`
  - `secret`
  - `private-key`
  - `encrypted-password`
  - `community`
- structured field masking for known payload shapes

This should later evolve from regex-heavy rules to typed masking per event payload where possible.

## Rendering Rules

The transcript should show that masking happened.

Examples:

- `[MASKED]`
- `[MASKED_PASSWORD]`
- `[MASKED_HASH]`
- `[MASKED_TOKEN]`

This is better than silent removal because it preserves context for debugging.

## Logging And Audit Of Masking

Each event should include masking metadata such as:

```json
{
  "masked": true,
  "rules_applied": [
    "password_prompt",
    "encrypted_password_pattern"
  ]
}
```

This allows support and engineering to understand why content was transformed.

## Known Tradeoff

Over-masking can reduce troubleshooting value, while under-masking creates security risk.

For v1, bias toward stronger masking.

## v1 Policy Summary

- mask before persistence
- mask before transcript rendering
- never retain raw secrets in normal backend logs
- preserve surrounding structure where it helps troubleshooting
- bias toward stronger masking if uncertain
