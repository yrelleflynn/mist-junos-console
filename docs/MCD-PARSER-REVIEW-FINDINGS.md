# mcd Parser Core Review Findings

Date: 2026-04-22  
Scope reviewed: parser core and parser-focused tests only

---

## Review focus

- log-format drift across JMA versions
- overfitting to exact source line numbers
- cycle splitting around `app.go:1040`
- SetState extraction
- kill-path classification
- parsing of `ccstate.go:511` disconnect-reason JSON
- handling of `ccstate.go:574` `event_sent` updates
- noisy logs with sparse signal
- empty/minimal input behavior

Files reviewed:

- `src/features/troubleshoot/mcd-log-parser.ts`
- `src/features/troubleshoot/mcd-log-parser.types.ts`
- `tests/mcd-log-parser.test.ts`

---

## 1) Bugs or likely misclassification risks (highest priority)

### High risk: marker overfit to exact source line numbers

Although parser comments state line-number independence, key behavior is currently anchored to exact line-numbered markers:

- cycle boundary: `app.go:1040`
- keep-alive path marker: `app.go:865`
- cloud-disconnect marker: `app.go:1110` and `ipc_server.go:161`
- SetState line examples in fixtures also stay on `ccstate.go:243`

Impact:

- line-number drift in JMA can silently break cycle splitting and kill-path classification without throwing parser errors.
- output may degrade to plausible-but-wrong (`null` killPath, missing retry interval/state extraction).

### High risk: kill-path classification can collapse to `null` under drift

`classifyKillPath` depends on exact marker regexes. If one marker changes and other signal remains, path classification becomes `null` even when the real path is evident from message text.

Impact:

- likely under-classification in future log variants
- reduced operator confidence in parser diagnoses

### Medium risk: strict formatting assumptions in `SetState` and retry extraction

- `SetState` regex expects exact `SetState(<digits>)`
- retry regex expects exact `will try again in <n>s`

Impact:

- whitespace or phrasing drift can silently drop state/retry extraction.

### Medium risk: strict 511/574 text and timestamp matching

- disconnect-reason extraction assumes exact phrases:
  - `updated disconnect reason: { ... }`
  - `updated disconnect reason event sent status: { ... }`
- 574 refinement requires exact timestamp string equality to 511 payload.

Impact:

- semantically equivalent timestamp formats (e.g. `Z` vs `+00:00`) may fail to reconcile.
- minor log phrase changes can bypass extraction.

### Low risk: empty string counts as one input line

`parseMcdLog('')` currently reports `totalLines = 1` due to `split('\n')`.

Impact:

- not a functional bug, but surprising semantics for metrics and call-site expectations.

---

## 2) Missing or weak tests (second priority)

### Missing drift tests for marker line-number changes

Current tests validate expected behavior using stable marker lines, but do not validate resilience when line numbers shift while message content remains equivalent.

Needed:

- fixtures where `app.go:1040`, `app.go:865`, `app.go:1110`, `ipc_server.go:161` line numbers differ.
- expected behavior should remain stable where semantics are unchanged.

### Missing format-variance tests

Needed tests for:

- SetState spacing variants
- retry line spacing/format variants
- 511/574 message text variants with same semantics
- benign JSON spacing and field-order changes

### Missing reconciliation edge tests for 511/574

Needed:

- timestamp normalization mismatch cases (`Z` vs `+00:00`, fractional seconds)
- same timestamp with different `cc_state`/reason payloads
- multiple 574 updates against multiple 511 events in same cycle

### Sparse/noisy log stress tests are limited

Existing tests cover noise-only and mixed logs well, but should add:

- long sparse windows with very few signal lines and multiple boundaries
- partial tail windows where only boundary or only SetState is present

### Minimal-input semantics tests could be more explicit

Keep existing tests but add explicit expectation notes for:

- why empty string reports one processed line
- why empty array reports zero lines

---

## 3) Assumptions that should be documented (third priority)

Document these parser-core assumptions clearly in code/docs:

1. **Cycle splitting assumption:** cycle ends only on `app.go:1040`.
2. **Kill-path assumption:** specific keep-alive/cloud-disconnect markers are authoritative.
3. **511 selection assumption:** when multiple 511 entries exist in a cycle, parser uses the last by line order.
4. **574 refinement scope:** 574 updates apply only within same parsed cycle window and only when timestamp string exactly matches selected 511 entry.
5. **Input counting assumption:** empty string is treated as one line after split.
6. **Signal filter assumption:** only lines matching current signal patterns are retained; all others are discarded as noise.

---

## Recommended next parser-test actions (concise)

1. Add realistic drift fixtures with changed marker line numbers.
2. Add formatting-variance fixtures for SetState/retry/511/574.
3. Add 511/574 mismatch and multi-event reconciliation cases.
4. Add sparse-tail fixtures (boundary-only, state-only, mixed minimal windows).
5. Explicitly document known assumptions in parser module comments.

