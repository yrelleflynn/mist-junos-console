# Bandwidth Optimisation Plan

> **Status:** Plan only — no code changes made yet.  
> **Context:** The remote-session relay and Mist API proxy both run over the operator's cellular connection. This plan targets meaningful reductions with minimal complexity, ordered by ROI.

---

## Baseline

Even before any optimisation the app is dramatically more efficient than video alternatives:

| Channel | Typical session |
|---------|----------------|
| Zoom (minimum quality) | ~7 MB / min |
| Screen share | ~2–4 MB / min |
| This app — text WebSocket relay | ~50–100 KB **total** |

The optimisations below improve on an already-lean baseline. Implement in priority order and measure before moving to the next.

---

## Phase 1 — Zero-effort wins (server/index.mjs)

### 1.1 WebSocket `perMessageDeflate`

**File:** `server/index.mjs` · line 386  
**Effort:** 1 line  
**Expected gain:** 60–80% reduction on terminal relay traffic (text with ANSI escapes compresses extremely well)

```js
// Before
const wss = new WebSocketServer({ noServer: true });

// After
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },   // balanced speed/ratio
    threshold: 256,                      // don't compress tiny frames
  },
});
```

The browser WebSocket client negotiates the extension automatically — no frontend changes needed.

---

### 1.2 HTTP compression for `/mist-proxy` responses

**File:** `server/index.mjs` · `mistProxyHandler` (line 301)  
**Effort:** ~10 lines  
**Expected gain:** 60–75% reduction on Mist API JSON responses (event lists, device inventory, etc.)

The proxy currently pipes the raw Mist API response body straight through. Wrap it in Node's built-in `zlib.createGzip()` stream and set `Content-Encoding: gzip`:

```js
import { createGzip } from 'node:zlib';

// inside mistProxyHandler, replace the proxyRes handler:
const proxyReq = https.request(url, { method: httpMethod, headers }, (proxyRes) => {
  const encoding = proxyRes.headers['content-encoding'];
  const isAlreadyGzipped = encoding === 'gzip' || encoding === 'br';

  res.writeHead(proxyRes.statusCode || 500, {
    'Content-Type': 'application/json',
    'Content-Encoding': isAlreadyGzipped ? encoding : 'gzip',
  });

  if (isAlreadyGzipped) {
    proxyRes.pipe(res);
  } else {
    proxyRes.pipe(createGzip()).pipe(res);
  }
});
```

The frontend `fetch()` caller decompresses automatically (browsers handle `Content-Encoding: gzip` natively).

---

## Phase 2 — Terminal output batching (server/index.mjs + frontend)

**File:** `server/index.mjs` · `serial-rx` handler (~line 500)  
**Effort:** ~20 lines  
**Expected gain:** Significant reduction in WebSocket message overhead; imperceptible latency impact at 16 ms

Currently `serial-rx` messages are forwarded immediately on each message receipt. On a noisy serial port this generates many small frames. Batch into ~16 ms windows before broadcasting to support members:

```js
// Per-session flush buffers — add alongside the sessions Map
/** @type {Map<string, { buf: string, timer: NodeJS.Timeout | null }>} */
const rxBuffers = new Map();

function flushRxBuffer(sessionId) {
  const entry = rxBuffers.get(sessionId);
  if (!entry || !entry.buf) return;
  broadcastToSupport(sessionId, { type: 'serial-rx', data: entry.buf });
  entry.buf = '';
  entry.timer = null;
}

// In the serial-rx case, replace the broadcastToSupport call:
case 'serial-rx': {
  // ... existing role check ...
  let entry = rxBuffers.get(sessionId);
  if (!entry) { entry = { buf: '', timer: null }; rxBuffers.set(sessionId, entry); }
  entry.buf += msg.data;
  if (!entry.timer) {
    entry.timer = setTimeout(() => flushRxBuffer(sessionId), 16);
  }
  return;
}
```

Also clean up the buffer on session close (in the `ws.on('close')` handler):

```js
rxBuffers.delete(sessionId);
```

---

## Phase 3 — Mist API response caching (server/index.mjs)

**File:** `server/index.mjs` · `mistProxyHandler`  
**Effort:** ~30 lines  
**Expected gain:** Eliminates repeat cloud round-trips when the operator re-runs checks during the same session

Mist event history and device context don't change on a sub-minute basis. A simple in-memory TTL cache keyed on `method + path` avoids redundant fetches:

```js
/** @type {Map<string, { body: string, statusCode: number, expires: number }>} */
const mistCache = new Map();
const MIST_CACHE_TTL_MS = 60_000; // 60 seconds

// At the top of the proxyRes handler, before making the upstream request:
const cacheKey = `${httpMethod}:${url}`;
if (httpMethod === 'GET') {
  const hit = mistCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    res.writeHead(hit.statusCode, { 'Content-Type': 'application/json' });
    res.end(hit.body);
    return;
  }
}

// After receiving the full response body, store it:
if (httpMethod === 'GET') {
  mistCache.set(cacheKey, {
    body: proxyBody,
    statusCode: proxyRes.statusCode,
    expires: Date.now() + MIST_CACHE_TTL_MS,
  });
}
```

**Note:** Only cache `GET` requests. Do not cache `POST` (event queries use POST with a body — see note below).

> **Mist event queries use POST** (`/api/v1/orgs/:id/devices/events/search`). To cache these, key on `POST:${url}:${sha256(body)}`. Worth doing but adds complexity — defer until Phase 3 is proven.

---

## Phase 4 — Selective Mist data fetching (frontend, `mist-api.service.ts`)

**File:** `src/services/mist-api.service.ts`  
**Effort:** Medium — requires audit of all call sites  
**Expected gain:** Avoids fetching cloud context for checks that don't need it

The check catalog already has `requiresCloud: boolean` on every entry (`src/config/check-catalog.config.ts`). Ensure that:

1. Cloud context is fetched lazily — only when the first `requiresCloud: true` check runs.
2. Checks with `requiresCloud: false` never trigger a Mist API call, even in a "Run All" flow.
3. The fetched context is cached for the lifetime of the session (already partially true via `MistContextController`).

Audit `runRecommendedChecks` in `troubleshoot.service.ts` to confirm the `requiresCloud` flag gates all upstream calls.

---

## Phase 5 — Binary serialisation for check results (future)

**Effort:** High — requires shared schema on both ends  
**Expected gain:** 20–30% reduction on check result payloads

Replace `JSON.stringify` / `JSON.parse` on the `/mcp/agent-context` and check result WebSocket messages with [MessagePack](https://msgpack.org/) (`@msgpack/msgpack` — ~6 KB gzipped). 

MessagePack is a drop-in replacement: same key/value structure, binary encoding, no schema definition required.

**Recommendation:** Defer until phases 1–4 are complete and a profiling baseline has been measured. At current payload sizes (~20–50 KB total), the gain is likely not worth the added dependency.

---

## Implementation Order

| Phase | File(s) | Effort | Expected Gain |
|-------|---------|--------|---------------|
| 1.1 `perMessageDeflate` | `server/index.mjs:386` | 1 line | 60–80% relay traffic |
| 1.2 HTTP gzip proxy | `server/index.mjs:344` | ~10 lines | 60–75% API responses |
| 2 Terminal batching | `server/index.mjs:500` | ~20 lines | Reduced frame overhead |
| 3 Mist cache | `server/index.mjs:301` | ~30 lines | Eliminates repeat fetches |
| 4 Selective fetch | `src/services/mist-api.service.ts` | Medium | Avoids unnecessary calls |
| 5 MessagePack | Both ends | High | 20–30% payload size |

---

## Measuring Improvement

Before implementing Phase 1, establish a baseline using Chrome DevTools → Network tab with "Slow 3G" throttling applied:

1. Connect to a device, run all checks, note total bytes transferred.
2. Apply Phase 1 changes, repeat, compare.

Key metrics to track:
- Total bytes transferred per "Run All" session
- WebSocket frame count (batching reduces this)
- Time to complete check suite on throttled connection
