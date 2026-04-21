# Junos Console Browser Extension

This Chrome / Edge extension launches local `junos-console` from a Mist switch
page with extension-backed Mist Launch context.

Current scope:

- detect a Mist switch page from the active tab URL
- resolve switch identity from the authenticated Mist browser session
- retrieve:
  - cloud / API host
  - org ID
  - site ID
  - switch ID
  - switch name
  - serial
  - MAC
  - `switch_mgmt.root_password`
  - `config_cmd`
  - monitor / status data
- show a floating `Open in Junos Console` action directly on supported Mist switch pages
- post the launch payload to the local backend
- open `http://localhost:3000/index.html` with a short-lived `mistLaunchToken`

## Load Unpacked

1. Open `chrome://extensions` or `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this `extension/` folder

## Current Assumptions

- `junos-console` is running locally on `http://localhost:3000`
- the local backend is running on `http://127.0.0.1:3333`
- the active browser tab is a Mist switch page
- the local app can still fall back to manual Mist API setup if launch hydration fails

## Notes

The extension-backed launch path is intended to be the preferred operator flow:

1. open a Mist switch page
2. click `Open in Junos Console`
3. connect the console cable
4. click `Login to Switch`
5. let the app verify the console-connected switch against the Mist-launched switch
6. only after match should Mist Status, Switch Cloud State, checks, and actions unlock

Important UX rules in Mist Launch Mode:

- `Identify Switch` and `Get Root Password` controls are hidden
- the app should use the Mist-launched root password directly when available
- `Mist Status` and `Switch Cloud State` remain `Unknown` until verification succeeds
- manual Mist API token setup is fallback only, not the primary launched workflow

This extension is still local-development oriented:

- unpacked install only
- localhost launch target
- no browser-store packaging yet
- no production auth / distribution story yet

The next logical steps are:

1. broaden page parsing beyond switch detail pages
2. harden launch diagnostics and error handling
3. extend support for richer event/history fetches
4. continue shrinking the remaining manual Mist setup fallback path
