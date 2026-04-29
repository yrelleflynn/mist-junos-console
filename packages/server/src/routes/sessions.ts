import { Hono } from 'hono';
import {
  createSession,
  getSession,
  listSessions,
  destroySession,
} from '../session/store.js';
import { runAllChecks, runCheck } from '../troubleshoot/runner.js';
import { hub } from '../ws/hub.js';
import type { CheckId, MistSession } from '@marvis/shared';

const JUNIPER_PROMPT = /[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+[>#%]\s*$/m;
const DEFAULT_TIMEOUT_MS = 15_000;

function makeCliExecutor(sessionId: string) {
  return {
    run(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
      return new Promise((resolve) => {
        let output = '';
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          hub.unsubscribeOutput(sessionId, onChunk);
          resolve(output);
        };

        const timer = setTimeout(finish, timeoutMs);

        const onChunk = (chunk: string) => {
          output += chunk;
          if (JUNIPER_PROMPT.test(output)) {
            clearTimeout(timer);
            finish();
          }
        };

        hub.subscribeOutput(sessionId, onChunk);
        hub.inject(sessionId, command + '\n');
      });
    },
  };
}

export const sessionsRouter = new Hono();

sessionsRouter.get('/', (c) => {
  return c.json({ success: true, data: listSessions() });
});

sessionsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    deviceMac: string;
    deviceSerial?: string;
    deviceHostname?: string;
    mistSession?: MistSession;
  }>();
  if (!body.deviceMac) {
    return c.json({ success: false, error: 'deviceMac is required' }, 400);
  }
  const session = createSession(body.deviceMac, {
    ...(body.deviceSerial !== undefined && { deviceSerial: body.deviceSerial }),
    ...(body.deviceHostname !== undefined && { deviceHostname: body.deviceHostname }),
    ...(body.mistSession !== undefined && { mistSession: body.mistSession }),
  });
  return c.json({ success: true, data: session }, 201);
});

sessionsRouter.get('/:id', (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);
  return c.json({ success: true, data: session });
});

sessionsRouter.get('/:id/state', (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);
  return c.json({
    success: true,
    data: {
      session,
      participantCount: session.participants.length,
      hasMistSession: session.mistSession !== undefined,
    },
  });
});

sessionsRouter.delete('/:id', (c) => {
  const destroyed = destroySession(c.req.param('id'));
  if (!destroyed) return c.json({ success: false, error: 'Session not found' }, 404);
  return c.json({ success: true });
});

sessionsRouter.post('/:id/checks/run', async (c) => {
  const sessionId = c.req.param('id');
  const session = getSession(sessionId);
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);

  const cli = makeCliExecutor(sessionId);

  const results = await runAllChecks(sessionId, cli, {
    ...(session.mistSession && { mistSession: session.mistSession }),
  });
  return c.json({ success: true, data: results });
});

sessionsRouter.post('/:id/checks/:checkId/run', async (c) => {
  const sessionId = c.req.param('id');
  const session = getSession(sessionId);
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);

  const checkId = c.req.param('checkId') as CheckId;
  const cli = makeCliExecutor(sessionId);

  const result = await runCheck(checkId, sessionId, cli, {
    ...(session.mistSession && { mistSession: session.mistSession }),
  });
  return c.json({ success: true, data: result });
});

sessionsRouter.get('/:id/output', (c) => {
  const sessionId = c.req.param('id');
  if (!getSession(sessionId)) return c.json({ success: false, error: 'Session not found' }, 404);

  const maxChars = parseInt(c.req.query('chars') ?? '10000', 10);
  const output = hub.getOutputBuffer(sessionId, Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 10_000);
  return c.json({ success: true, data: { sessionId, output } });
});

sessionsRouter.post('/:id/command', async (c) => {
  const sessionId = c.req.param('id');
  if (!getSession(sessionId)) return c.json({ success: false, error: 'Session not found' }, 404);

  const body = await c.req.json<{ command: string; timeoutMs?: number }>();
  if (!body.command?.trim()) {
    return c.json({ success: false, error: 'command is required' }, 400);
  }

  const cli = makeCliExecutor(sessionId);
  const output = await cli.run(body.command.trim(), body.timeoutMs);
  return c.json({ success: true, data: { sessionId, command: body.command.trim(), output } });
});
