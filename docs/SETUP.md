# Setup Instructions

## Purpose

Provide explicit setup and run instructions for reviewers, developers, and
hackathon judges.

## Prerequisites

- macOS, Windows, or Linux with:
  - Node.js 20+ recommended
  - npm
  - Chrome or Edge for Web Serial support
- a Juniper EX switch connected by USB or serial console cable
- optional:
  - Mist API token
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
2. Connect the serial cable to the switch.
3. Use `Connect` and complete the browser serial picker if needed.
4. Log in to the switch.
5. Optionally configure Mist API details.
6. Identify the switch.
7. Run `Run Recommended Checks` or `Run Full Baseline`.

## Support Session Workflow

1. In the operator UI, enable `Enable remote session`.
2. Copy the generated session ID.
3. Open `support.html` in a second browser window.
4. Paste the session ID and connect.

Current security note:

- treat the session ID as a secret
- use only in controlled/demo environments until stronger auth is added

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
