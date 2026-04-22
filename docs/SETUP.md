# Setup Instructions

## Purpose

Provide explicit setup and run instructions for reviewers, developers, and
submission reviewers.

## Prerequisites

- macOS, Windows, or Linux with:
  - Node.js 20+ recommended
  - npm
  - Chrome or Edge for Web Serial support
- a Juniper EX switch connected by USB or serial console cable
- optional:
  - browser extension loaded from `extension/` for Mist Launch Mode
  - Mist API token for manual fallback mode
  - backend access for remote support and MCP testing

## Quick Start

From the repository root:

```bash
npm install
npm run dev
```

This starts:

- backend server on `http://127.0.0.1:3333`
- frontend on `http://localhost:3000`

## Local URLs

- operator UI:
  - `http://localhost:3000/`
- support console:
  - `http://localhost:3000/support.html`
- backend health:
  - `http://127.0.0.1:3333/health`

## First Run Workflow

1. Open the operator UI in Chrome or Edge.
2. If you want the preferred flow, open a Mist switch page and launch via the browser extension.
3. Connect the serial cable to the switch.
4. Use `Connect` and complete the browser serial picker if needed.
5. Click `Login to Switch`.
6. In Mist Launch Mode, let the app use the Mist-launched root password when available and verify the console-connected switch against the Mist-launched switch.
7. After the Mist Launch card turns green, run `Run Recommended Checks` or `Run Full Baseline`.

## Mist Launch Mode

Preferred workflow:

1. Start the frontend and backend locally.
2. Load the unpacked extension from [extension/README.md](/Users/mdusty/Library/CloudStorage/OneDrive-HewlettPackardEnterprise/Documents/03 Mist Docs/07 Projects/mist-junos-console/extension/README.md).
3. Open a Mist switch page in the browser.
4. Click `Open in Junos Console`.
5. In the app:
   - connect the serial session
   - click `Login to Switch`
   - wait for switch verification
6. Only after verification succeeds should `Mist Status`, `Switch Cloud State`, checks, and actions be considered trusted.

Expected behavior in Mist Launch Mode:

- `Identify Switch` and `Get Root Password` controls are hidden
- the Mist Launch card shows waiting, mismatch, or matched state
- `Mist Status` and `Switch Cloud State` remain `Unknown` until verification succeeds
- the manual Mist API modal remains available as fallback only
- `Adopt Switch` uses the same staged candidate preview flow as `Config Sync`, so both workflows end in diff review plus Commit / Rollback

## Manual Fallback Mode

Use this when:

- you did not launch from Mist
- the extension is unavailable
- launch hydration failed
- you intentionally want to test the manual API workflow

Workflow:

1. Open `http://localhost:3000/` directly.
2. Connect serial and log in.
3. Configure Mist API details manually if needed.
4. Identify the switch.
5. Run checks or actions.

## Support Session Workflow

1. In the operator UI, enable `Enable remote session`.
2. Copy the generated session ID.
3. Open `support.html` in a second browser window.
4. Paste the session ID and connect.

Current security note:

- treat the session ID as a secret
- use only in controlled/reviewer environments until stronger auth is added

## Build And Test

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Production-Style Deployment Notes

For a hosted deployment:

- serve the built frontend over HTTPS
- run the Node backend alongside it
- expose the frontend and backend on the same trusted origin or with explicit
  origin configuration
- preserve the operator-owned Web Serial model in the browser

## Known Environment Assumptions

- Web Serial requires Chrome or Edge
- browser serial selection still uses the native picker unless an authorized
  port is already available
- the current product model assumes a controlled deployment for remote support
  sessions
