import { Hono } from 'hono';
import { mistProxy } from '../mist/proxy.js';
import type { ServerConfig } from '../config.js';

export function createMistRouter(config: ServerConfig): Hono {
  const router = new Hono();
  router.all('/*', (c) => mistProxy(c, config.mistProxyTimeoutMs));
  return router;
}
