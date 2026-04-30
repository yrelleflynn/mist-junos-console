import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckId, CheckResult, MistSession } from '@marvis/shared';
import { SessionSetup } from './components/SessionSetup.js';
import { Terminal, type TerminalHandle } from './components/Terminal.js';
import { TroubleshootPanel } from './components/TroubleshootPanel.js';
import { useConsoleWs } from './hooks/useConsoleWs.js';
import { useSerial } from './hooks/useSerial.js';
import { detectSession } from './session/providers.js';

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [mistSession, setMistSession] = useState<MistSession | null>(null);
  const [results, setResults] = useState<Map<CheckId, CheckResult>>(new Map());
  const [running, setRunning] = useState(false);
  const termRef = useRef<TerminalHandle>(null);

  const serial = useSerial();
  const ws = useConsoleWs(sessionId, 'console');

  useEffect(() => {
    detectSession().then((s) => {
      if (s) setMistSession(s);
    });
  }, []);

  useEffect(() => {
    if (!ws.lastMessage) return;
    const msg = ws.lastMessage;

    if (msg.type === 'session:state') {
      setParticipantId(msg.participantId);
    } else if (msg.type === 'serial:data') {
      termRef.current?.write(new TextEncoder().encode(msg.data));
    } else if (msg.type === 'serial:inject') {
      serial.write(new TextEncoder().encode(msg.data));
    } else if (msg.type === 'check:progress') {
      setResults((prev) => {
        const next = new Map(prev);
        next.set(msg.checkId, {
          checkId: msg.checkId,
          status: msg.status,
          summary: msg.summary ?? '',
        });
        return next;
      });
    } else if (msg.type === 'check:result') {
      setResults((prev) => {
        const next = new Map(prev);
        next.set(msg.checkId, msg.result);
        return next;
      });
    } else if (msg.type === 'check:complete') {
      setRunning(false);
    } else if (msg.type === 'error') {
      console.error('[ws] server error:', msg.code, msg.message);
    }
  }, [ws.lastMessage]);

  // Serial port RX (switch → browser): relay to server for other participants.
  const handleSerialRx = useCallback(
    (data: Uint8Array) => {
      termRef.current?.write(data);
      ws.send({ type: 'serial:write', sessionId: sessionId ?? '', data: new TextDecoder().decode(data) });
    },
    [ws, sessionId],
  );

  // Terminal keyboard input: write to serial port AND relay to server.
  const handleTerminalInput = useCallback(
    (data: Uint8Array) => {
      serial.write(data);
      ws.send({ type: 'serial:write', sessionId: sessionId ?? '', data: new TextDecoder().decode(data) });
    },
    [ws, serial, sessionId],
  );

  async function handleSetupComplete(mac: string, session: MistSession | null, hostname?: string) {
    if (session) setMistSession(session);
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceMac: mac,
        deviceHostname: hostname,
        ...(session && { mistSession: session }),
      }),
    });
    const json = (await res.json()) as { success: boolean; data?: { id: string } };
    if (json.success && json.data) {
      setSessionId(json.data.id);
    }
  }

  function handleRunAll() {
    if (!sessionId) return;
    setRunning(true);
    setResults(new Map());
    fetch(`/api/sessions/${sessionId}/checks/run`, { method: 'POST' }).catch(() =>
      setRunning(false),
    );
  }

  function handleRunOne(checkId: CheckId) {
    if (!sessionId) return;
    setRunning(true);
    fetch(`/api/sessions/${sessionId}/checks/${checkId}/run`, { method: 'POST' }).catch(
      () => setRunning(false),
    );
  }

  if (!sessionId) {
    return <SessionSetup onComplete={handleSetupComplete} />;
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--color-bg)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 14px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '14px' }}>Marvis Console</span>
          <StatusDot label="WS" active={ws.status === 'connected'} />
          <StatusDot label="Serial" active={serial.status === 'open'} />
          {mistSession && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginLeft: '4px' }}>
              {mistSession.cloud}
            </span>
          )}
          {serial.status === 'open' && (
            <button
              onClick={() => serial.close()}
              style={{
                marginLeft: 'auto',
                padding: '4px 10px',
                fontSize: '11px',
                background: 'var(--color-surface-2)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          )}
        </header>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Terminal ref={termRef} onData={handleTerminalInput} />
          {serial.status !== 'open' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(13,13,15,0.88)',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                {serial.status === 'error' ? 'Serial port error — try again' : 'No serial port connected'}
              </span>
              <button
                onClick={() => serial.open(handleSerialRx)}
                style={{
                  padding: '10px 22px',
                  fontSize: '13px',
                  fontWeight: 700,
                  background: 'var(--color-accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Select Serial Port
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ width: '320px', flexShrink: 0 }}>
        <TroubleshootPanel
          results={results}
          running={running}
          onRunAll={handleRunAll}
          onRunOne={handleRunOne}
        />
      </div>
    </div>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: active ? 'var(--color-pass)' : 'var(--color-border)',
        }}
      />
      {label}
    </span>
  );
}
