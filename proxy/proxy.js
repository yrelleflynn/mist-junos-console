/**
 * proxy.js — Lightweight local proxy for Mist API calls
 *
 * Forwards requests from the browser to the Mist API to bypass CORS.
 * Runs on port 4000 by default.
 *
 * Usage: node proxy/proxy.js
 */

import http from 'node:http';
import https from 'node:https';

const PORT = 4000;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only handle POST /mist-proxy
  if (req.method === 'POST' && req.url === '/mist-proxy') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { apiHost, apiToken, method, path } = JSON.parse(body);

        if (!apiHost || !apiToken || !path) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing apiHost, apiToken, or path' }));
          return;
        }

        const url = `https://${apiHost}${path}`;
        console.log(`[proxy] ${method || 'GET'} ${url}`);

        const proxyRes = await fetchHttps(url, {
          method: method || 'GET',
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json',
          },
        });

        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(proxyRes.body);
      } catch (err) {
        console.error('[proxy] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

/**
 * Simple HTTPS GET/POST using node:https
 */
function fetchHttps(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

server.listen(PORT, () => {
  console.log(`[proxy] Mist API proxy running on http://localhost:${PORT}`);
  console.log(`[proxy] POST /mist-proxy — forward requests to Mist API`);
  console.log(`[proxy] GET  /health     — health check`);
});
