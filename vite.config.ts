import { defineConfig, Plugin } from 'vite';
import https from 'node:https';

/**
 * Vite plugin that adds a /mist-proxy endpoint to the dev server.
 * Forwards requests to the Mist API to bypass CORS.
 * No separate proxy server needed.
 */
function mistProxyPlugin(): Plugin {
  return {
    name: 'mist-api-proxy',
    configureServer(server) {
      server.middlewares.use('/mist-proxy', (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const { apiHost, apiToken, method, path } = parsed;
            const requestBody = parsed.body ? JSON.stringify(parsed.body) : null;

            if (!apiHost || !apiToken || !path) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing apiHost, apiToken, or path' }));
              return;
            }

            const url = `https://${apiHost}${path}`;
            const httpMethod = method || 'GET';
            console.log(`[mist-proxy] ${httpMethod} ${url}${requestBody ? ` (body: ${requestBody.length} bytes)` : ''}`);

            const headers: Record<string, string> = {
              'Authorization': `Token ${apiToken}`,
              'Content-Type': 'application/json',
            };
            if (requestBody) {
              headers['Content-Length'] = Buffer.byteLength(requestBody).toString();
            }

            const proxyReq = https.request(url, {
              method: httpMethod,
              headers,
            }, (proxyRes) => {
              let proxyBody = '';
              proxyRes.on('data', (chunk: Buffer) => { proxyBody += chunk.toString(); });
              proxyRes.on('end', () => {
                res.writeHead(proxyRes.statusCode || 500, { 'Content-Type': 'application/json' });
                res.end(proxyBody);
              });
            });

            proxyReq.on('error', (err) => {
              console.error('[mist-proxy] Error:', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            });

            if (requestBody) {
              proxyReq.write(requestBody);
            }
            proxyReq.end();
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
  plugins: [mistProxyPlugin()],
});
