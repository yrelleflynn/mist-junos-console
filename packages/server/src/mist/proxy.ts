import type { Context } from 'hono';
import { cloudConfig } from '@marvis/shared';
import type { MistCloud } from '@marvis/shared';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

export async function mistProxy(c: Context, timeoutMs: number): Promise<Response> {
  const method = c.req.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return c.json({ success: false, error: 'Method not allowed' }, 405);
  }

  const cloudHeader = c.req.header('x-mist-cloud') as MistCloud | undefined;
  const csrfToken = c.req.header('x-mist-csrf');
  const sessionId = c.req.header('x-mist-session');

  if (!cloudHeader || !csrfToken || !sessionId) {
    return c.json(
      { success: false, error: 'Missing required headers: x-mist-cloud, x-mist-csrf, x-mist-session' },
      400,
    );
  }

  let config;
  try {
    config = cloudConfig(cloudHeader);
  } catch {
    return c.json({ success: false, error: `Unknown cloud: ${cloudHeader}` }, 400);
  }

  const url = new URL(c.req.url);
  const mistPath = url.pathname.replace(/^\/api\/mist/, '');
  const targetUrl = `${config.apiBase}/api/v1${mistPath}${url.search}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cookie': `csrftoken=${csrfToken}; sessionid=${sessionId}`,
    'X-CSRFToken': csrfToken,
  };

  const body = method !== 'GET' && method !== 'DELETE' ? await c.req.text() : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      ...(body !== undefined && { body }),
      signal: controller.signal,
    });

    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return c.json({ success: false, error: 'Mist API request timed out' }, 504);
    }
    console.error('[mist-proxy] upstream error:', err);
    return c.json({ success: false, error: 'Mist API request failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
}
