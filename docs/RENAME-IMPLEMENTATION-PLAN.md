# Rename Implementation Plan: Junos Console → Mist Local Console

## Overview

This document is the step-by-step implementation plan for renaming the app
from **Junos Console** to **Mist Local Console**.

Total scope: ~200 references across 49 files. The rename is mechanical but
needs to be done in the right order to avoid breaking the extension message
protocol or wiping user preferences.

---

## What stays unchanged

The following contain "junos" but refer to **Junos OS** (the operating system),
not the app name. Do not rename these.

| Item | Reason |
|------|--------|
| `src/services/junos-highlight.service.ts` | Junos OS syntax highlighting |
| `src/utils/junos-log-time.ts` | Junos log timestamp parsing |
| `tests/junos-highlight.service.test.ts` | Tests for Junos OS highlighting |
| CSS classes `.junos-highlight-block`, `.junos-line-*`, `.junos-token-*` | Junos OS syntax rendering |
| Commit comment strings `"junos console config sync"` | Written into switch commit log — changing would alter production switch history annotations |

---

## Phase 1 — User-facing strings

**Goal:** The app looks and feels renamed. Independent of any internal wiring.
Safe to ship before other phases.

### 1.1 `index.html`

| Line | Change |
|------|--------|
| 6 | `<title>Junos Console</title>` → `<title>Mist Local Console</title>` |
| 16 | `<h1>Junos Console</h1>` → `<h1>Mist Local Console</h1>` |

### 1.2 `support.html`

| Line | Change |
|------|--------|
| 6 | `<title>Junos Console — Support</title>` → `<title>Mist Local Console — Support</title>` |

### 1.3 `extension/popup.html`

| Line | Change |
|------|--------|
| 6 | `<title>Junos Console</title>` → `<title>Mist Local Console</title>` |
| 12 | `JUNOS CONSOLE` eyebrow → `MIST LOCAL CONSOLE` |
| 14 | subtitle copy: `"Open the local Junos Console app..."` → `"Open the Mist Local Console app..."` |
| 44 | button label: `Open in Junos Console` → `Open in Mist Local Console` |

### 1.4 `extension/manifest.json`

| Field | Change |
|-------|--------|
| `name` (line 3) | `"Junos Console"` → `"Mist Local Console"` |
| `short_name` (line 4) | `"Junos Console"` → `"Mist Local Console"` |
| `default_title` (line 9) | `"Junos Console"` → `"Mist Local Console"` |
| `description` (line 6) | `"Launch Junos Console from Mist switch pages..."` → `"Launch Mist Local Console from Mist switch pages..."` |

### 1.5 `extension/content.js`

| Line | Change |
|------|--------|
| 27 | `'Open in Junos Console'` → `'Open in Mist Local Console'` |
| 330 | `button.textContent = 'Open in Junos Console'` → `'Open in Mist Local Console'` |

### 1.6 `extension/popup.js`

| Line | Change |
|------|--------|
| 130 | status message: `"...then launch Junos Console from here."` → `"...then launch Mist Local Console from here."` |
| 141 | status message: `"...can launch Junos Console with scoped context."` → `"...can launch Mist Local Console with scoped context."` |

### 1.7 `src/main.ts`

| Line | Change |
|------|--------|
| 4925 | `'Junos Console ready. Click "Connect"...'` → `'Mist Local Console ready. Click "Connect"...'` |

### 1.8 `server/index.mjs`

| Line | Change |
|------|--------|
| 2 | File header comment: `Junos Console backend` → `Mist Local Console backend` |
| 560 | `[junos-console-server]` log prefix → `[mist-local-console-server]` |
| 561 | same prefix in second startup log line |

### 1.9 `mcp/server.ts`

| Line | Change |
|------|--------|
| 2 | File header comment: `junos-console Backend MCP Server` → `mist-local-console Backend MCP Server` |
| 1324 | `[junos-console-mcp]` error prefix → `[mist-local-console-mcp]` |

### 1.10 `src/styles/main.css`

| Line | Change |
|------|--------|
| 2 | Comment: `Junos Console — Stylesheet` → `Mist Local Console — Stylesheet` |

### Acceptance criteria — Phase 1

- [ ] Page `<title>` reads "Mist Local Console" in browser tab
- [ ] `<h1>` header in the app reads "Mist Local Console"
- [ ] Extension popup shows "Mist Local Console" throughout
- [ ] Extension toolbar tooltip reads "Mist Local Console"
- [ ] Injected "Open in Mist Local Console" button appears on Mist switch pages
- [ ] Server startup logs use new prefix
- [ ] No user-visible string still reads "Junos Console"

---

## Phase 2 — Extension internal identifiers

**Goal:** Rename the internal message protocol and global namespace. Must be
done as a single atomic commit — all four extension files change together.
If any file is updated without the others, the message protocol breaks and
the extension stops working.

### 2.1 Global namespace object

Rename `JunosConsoleMistContext` → `MistLocalConsoleMistContext` in all four
files.

| File | Lines affected |
|------|---------------|
| `extension/mist-context.js` | Line 108: `root.JunosConsoleMistContext = {` |
| `extension/content.js` | Line 85: `window.JunosConsoleMistContext?.parseMistContextFromUrl(...)` |
| `extension/background.js` | Line 416: `globalThis.JunosConsoleMistContext?.parseMistContextFromUrl(...)` |
| `extension/popup.js` | Line 124: `window.JunosConsoleMistContext?.parseMistContextFromUrl(...)` |

### 2.2 Message type constants

Replace the `'junos-console:'` prefix with `'mist-local-console:'` across all
nine message type strings.

| File | Line | Current | Change to |
|------|------|---------|-----------|
| `extension/content.js` | 115 | `'junos-console:resolve-context'` | `'mist-local-console:resolve-context'` |
| `extension/content.js` | 132 | `'junos-console:create-launch'` | `'mist-local-console:create-launch'` |
| `extension/content.js` | 311 | `'junos-console:get-context'` | `'mist-local-console:get-context'` |
| `extension/background.js` | 552 | `'junos-console:resolve-context'` | `'mist-local-console:resolve-context'` |
| `extension/background.js` | 558 | `'junos-console:create-launch'` | `'mist-local-console:create-launch'` |
| `extension/popup.js` | 29 | `'junos-console:get-context'` | `'mist-local-console:get-context'` |
| `extension/popup.js` | 40 | `'junos-console:resolve-context'` | `'mist-local-console:resolve-context'` |
| `extension/popup.js` | 54 | `'junos-console:create-launch'` | `'mist-local-console:create-launch'` |

### 2.3 Extension DOM button ID

| File | Line | Change |
|------|------|--------|
| `extension/content.js` | 2 | `BUTTON_ID = 'junos-console-launcher'` → `'mist-local-console-launcher'` |

### Acceptance criteria — Phase 2

- [ ] Extension popup opens and resolves switch context correctly
- [ ] "Open in Mist Local Console" button appears on Mist switch pages
- [ ] Cross-launch passes context to the console app
- [ ] No console errors about unrecognised message types
- [ ] All four extension files committed together in one change

---

## Phase 3 — localStorage keys + migration shim

**Goal:** Rename internal storage keys without wiping existing user
preferences (saved port, cloud, org, panel layout).

**Why a migration shim is required:** localStorage keys are keyed by string.
If you change the key name, existing users silently lose their saved
preferences on next load. The shim copies old values to new keys once,
then deletes the old ones.

### 3.1 New key names

| Old key | New key |
|---------|---------|
| `junos-console.serial-prefs` | `mist-local-console.serial-prefs` |
| `junos-console.last-port-label` | `mist-local-console.last-port-label` |
| `junos-console.mist-cloud-id` | `mist-local-console.mist-cloud-id` |
| `junos-console.mist-org-id` | `mist-local-console.mist-org-id` |
| `junos-console.remote-session-enabled` | `mist-local-console.remote-session-enabled` |
| `junos-console.results-panel-height` | `mist-local-console.results-panel-height` |
| `junos-console.guidance-panel-width` | `mist-local-console.guidance-panel-width` |

### 3.2 Migration shim

Add the following function to `src/main.ts` and call it at the very start
of `init()`, before any localStorage reads:

```typescript
/**
 * One-time migration of localStorage keys from the old "junos-console.*"
 * namespace to "mist-local-console.*". Runs once per browser profile.
 * Safe to call on every load — no-ops if migration has already run.
 */
function migrateLocalStorageKeys(): void {
  const MIGRATION_FLAG = 'mist-local-console.migrated-from-junos-console';
  if (localStorage.getItem(MIGRATION_FLAG)) return;

  const keyMap: Record<string, string> = {
    'junos-console.serial-prefs':            'mist-local-console.serial-prefs',
    'junos-console.last-port-label':         'mist-local-console.last-port-label',
    'junos-console.mist-cloud-id':           'mist-local-console.mist-cloud-id',
    'junos-console.mist-org-id':             'mist-local-console.mist-org-id',
    'junos-console.remote-session-enabled':  'mist-local-console.remote-session-enabled',
    'junos-console.results-panel-height':    'mist-local-console.results-panel-height',
    'junos-console.guidance-panel-width':    'mist-local-console.guidance-panel-width',
  };

  for (const [oldKey, newKey] of Object.entries(keyMap)) {
    const value = localStorage.getItem(oldKey);
    if (value !== null) {
      localStorage.setItem(newKey, value);
      localStorage.removeItem(oldKey);
    }
  }

  localStorage.setItem(MIGRATION_FLAG, '1');
}
```

### 3.3 Update key constants

Update all seven `*_STORAGE_KEY` constants in `src/main.ts` (lines 39–43,
1145, 1208) to use the new `mist-local-console.*` prefix.

### Acceptance criteria — Phase 3

- [ ] Existing users retain their saved serial port, cloud, org, panel layout
- [ ] Migration runs once and sets the migration flag
- [ ] No reads from old `junos-console.*` keys after migration
- [ ] New installs write directly to `mist-local-console.*` keys

---

## Phase 4 — Package names and environment variables

**Goal:** Update package identity and server configuration. No user impact
but affects developer tooling and deployment.

### 4.1 `package.json`

```json
"name": "mist-local-console"
```

### 4.2 `mcp/package.json`

```json
"name": "mist-local-console-mcp"
```

### 4.3 `server/index.mjs`

| Line | Change |
|------|--------|
| 11 | `process.env.JUNOS_CONSOLE_SERVER_PORT` → `process.env.MIST_LOCAL_CONSOLE_SERVER_PORT` |

Add backward-compat fallback so deployments using the old env var still work:
```js
const PORT = Number(
  process.env.MIST_LOCAL_CONSOLE_SERVER_PORT ||
  process.env.JUNOS_CONSOLE_SERVER_PORT ||   // legacy — remove after cutover
  3333
);
```

### 4.4 `vite.config.ts`

Update the comment reference to `JUNOS_CONSOLE_SERVER_PORT` and the
`VITE_CONSOLE_SERVER_PORT` reference to match the new name.

### 4.5 `package-lock.json` and `mcp/package-lock.json`

Regenerate both lock files after updating `package.json` and
`mcp/package.json`:

```bash
npm install          # regenerates package-lock.json
cd mcp && npm install  # regenerates mcp/package-lock.json
```

### 4.6 `.env` files / deployment config

Search for `JUNOS_CONSOLE_SERVER_PORT` in any `.env`, `.env.local`, Docker,
CI/CD, or deployment config files and update to `MIST_LOCAL_CONSOLE_SERVER_PORT`.
Use the legacy fallback in step 4.3 as a safety net during the transition.

### Acceptance criteria — Phase 4

- [ ] `npm run dev` starts correctly with new env var name
- [ ] Legacy `JUNOS_CONSOLE_SERVER_PORT` env var still works during transition
- [ ] Both lock files regenerated cleanly
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)

---

## Phase 5 — Documentation

**Goal:** Update all docs to reflect the new name. No runtime impact.

### 5.1 Rename one doc file

```bash
git mv docs/JUNOS-CONSOLE-EXTENSION-V1-FLOW.md \
       docs/MIST-LOCAL-CONSOLE-EXTENSION-V1-FLOW.md
```

Update any cross-references to this file in other docs.

### 5.2 Bulk find-and-replace in `docs/`

Run these replacements across all `.md` files in `docs/`:

| Find | Replace |
|------|---------|
| `Junos Console` | `Mist Local Console` |
| `JUNOS CONSOLE` | `MIST LOCAL CONSOLE` |
| `junos-console` (in prose/headings) | `mist-local-console` |
| `mist-junos-console` (in prose/code spans) | `mist-local-console` |

**Exception:** Do not replace `mist-junos-console` in absolute file paths
(e.g. `/Users/mdusty/.../mist-junos-console/`) unless the directory is also
being renamed (Phase 6). Those paths are machine-specific and already
non-portable.

### 5.3 Update `README.md`

| Line | Change |
|------|--------|
| 1 | `# Junos Console — Web Serial Terminal` → `# Mist Local Console` |
| 183–184 | Update `JUNOS_CONSOLE_SERVER_PORT` / `VITE_CONSOLE_SERVER_PORT` references |

### 5.4 Update `CLAUDE.md`

Check and update any remaining `junos-console` or `Junos Console` references
(there are a few in the MCP section and running instructions).

### 5.5 Update `docs/TROUBLESHOOTING-CHECK-REFERENCE.md`

| Line | Change |
|------|--------|
| 1 | `# MIST JUNOS CONSOLE` → `# MIST LOCAL CONSOLE` |
| 8 | `mist-junos-console is a single-page web application...` → `mist-local-console is...` |
| 129 | `## JUNOS CONSOLE — CLOUD CONNECTIVITY CHECK: TEST REFERENCE` → `## MIST LOCAL CONSOLE — CLOUD CONNECTIVITY CHECK: TEST REFERENCE` |

### 5.6 Update `extension/README.md`

Update references to `Junos Console` and `Open in Junos Console` button
descriptions.

### Acceptance criteria — Phase 5

- [ ] No doc file heading reads "Junos Console"
- [ ] `JUNOS-CONSOLE-EXTENSION-V1-FLOW.md` renamed and cross-references updated
- [ ] `TROUBLESHOOTING-CHECK-REFERENCE.md` headings updated
- [ ] `CLAUDE.md` consistent with new name throughout

---

## Phase 6 — Directory rename (optional)

**Goal:** Rename the project directory from `mist-junos-console` to
`mist-local-console`. This is purely cosmetic — no runtime behaviour
depends on the directory name.

**When to do this:** After all other phases are complete and stable.
Coordinate with anyone who has the repo cloned locally.

### Steps

```bash
# From the parent directory:
mv "mist-junos-console" "mist-local-console"

# Update git remote if needed:
cd mist-local-console
git remote set-url origin <new-repo-url-if-renamed-on-remote>
```

### Impact

- All absolute paths in documentation (e.g.
  `/Users/mdusty/.../mist-junos-console/`) become stale — these are
  machine-specific anyway and only affect local navigation hints in docs
- Any CI/CD scripts that reference the directory name by path need updating
- MCP config examples in `CLAUDE.md` and `BACKEND-MCP-POC.md` that contain
  absolute paths need updating after the move

### Acceptance criteria — Phase 6

- [ ] Directory renamed in filesystem and git history intact
- [ ] `npm run dev` works from new directory
- [ ] MCP server starts correctly from new path
- [ ] CI/CD passes (if applicable)

---

## Phased delivery summary

| Phase | What changes | Files | Risk | Dependency |
|-------|-------------|-------|------|------------|
| 1 | User-facing strings | 10 | Low | None |
| 2 | Extension internals | 4 | Medium — all 4 files must ship together | Phase 1 complete |
| 3 | localStorage keys + migration | 1 | Medium — migration shim required | None |
| 4 | Package names + env vars | 4 + lock files | Low | None |
| 5 | Documentation | 20+ | Low | Phases 1–4 complete |
| 6 | Directory rename | 1 + CI | Low | All phases complete |

Phases 1, 3, and 4 are independent and can be done in any order or in
parallel. Phase 2 must be done atomically. Phase 5 should follow 1–4 so
doc references match the code. Phase 6 is last and optional.

---

## Testing checklist (full regression)

After all phases are complete, verify:

- [ ] App loads at `localhost:3000` with correct title and header
- [ ] Support page loads at `localhost:3000/support.html` with correct title
- [ ] Extension popup shows "Mist Local Console" throughout
- [ ] Extension injects "Open in Mist Local Console" button on Mist switch pages
- [ ] Cross-launch from extension opens console with correct context
- [ ] Serial port preferences persist across reload (localStorage migration)
- [ ] Cloud/org selection persists across reload (localStorage migration)
- [ ] Panel layout persists across reload (localStorage migration)
- [ ] `npm run dev` starts with no errors
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] MCP server starts and tools respond correctly
- [ ] Backend server starts on correct port with new env var name
- [ ] Legacy `JUNOS_CONSOLE_SERVER_PORT` env var still starts the server
