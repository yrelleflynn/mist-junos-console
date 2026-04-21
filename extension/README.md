# Junos Console Browser Extension

This is an early Chrome / Edge extension scaffold for launching local
`junos-console` from a Mist switch page with pre-scoped Mist context.

Current V1 scope:

- detect a Mist switch page from the active tab URL
- extract:
  - cloud / API host
  - org ID
  - site ID
  - switch ID
- show a floating `Open in Junos Console` action directly on supported Mist switch pages
- open `http://localhost:3000/index.html` with a `mistContext` launch payload

## Load Unpacked

1. Open `chrome://extensions` or `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this `extension/` folder

## Current Assumptions

- `junos-console` is running locally on `http://localhost:3000`
- the active browser tab is a Mist switch page
- the local app still uses its normal Mist API setup flow as fallback

## Notes

This scaffold intentionally keeps the first version small:

- popup plus a lightweight page launcher
- no cookie/session handling yet
- no direct Mist API calls from the extension yet
- no special icons or store packaging yet

The next logical steps are:

1. broaden page parsing beyond switch detail pages
2. add extension-side Mist session awareness
3. pass richer context such as site and device display names
4. eventually replace most manual Mist setup in the local app
