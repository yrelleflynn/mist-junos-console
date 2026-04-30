import { useState } from 'react';
import type { MistCloud, MistSession } from '@marvis/shared';
import { MIST_CLOUDS } from '@marvis/shared';
import { buildManualSession, saveExtensionId } from '../session/providers.js';

interface SessionSetupProps {
  onComplete: (mac: string, session: MistSession | null, hostname?: string) => void;
}

type Tab = 'console' | 'mist' | 'extension';

const TAB_LABELS: Record<Tab, string> = {
  console: 'Console Only',
  mist: 'Mist Session',
  extension: 'Extension',
};

export function SessionSetup({ onComplete }: SessionSetupProps) {
  const [tab, setTab] = useState<Tab>('console');
  const [label, setLabel] = useState('');
  const [mac, setMac] = useState('');
  const [hostname, setHostname] = useState('');
  const [cloud, setCloud] = useState<MistCloud>('global01');
  const [csrf, setCsrf] = useState('');
  const [sid, setSid] = useState('');
  const [extId, setExtId] = useState('');
  const [error, setError] = useState('');

  function handleConsoleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const placeholderMac = 'local-' + Math.random().toString(16).slice(2, 10);
    onComplete(placeholderMac, null, label.trim() || undefined);
  }

  function handleMistSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!mac.trim()) { setError('Device MAC address is required'); return; }
    if (!csrf.trim() || !sid.trim()) { setError('CSRF token and session ID are required'); return; }
    const session = buildManualSession(cloud, csrf.trim(), sid.trim());
    onComplete(mac.trim(), session, hostname.trim() || undefined);
  }

  function handleExtensionSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!extId.trim()) { setError('Extension ID is required'); return; }
    saveExtensionId(extId.trim());
    setError('Extension ID saved — reload to detect session automatically.');
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: '5px',
    color: 'var(--color-text)',
    fontSize: '13px',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginBottom: '4px',
  };

  const submitStyle: React.CSSProperties = {
    padding: '9px',
    fontSize: '13px',
    fontWeight: 600,
    background: 'var(--color-accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    marginTop: '4px',
    cursor: 'pointer',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: 'var(--color-bg)',
      }}
    >
      <div
        style={{
          width: '420px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '10px',
          padding: '28px 32px',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Marvis Console</h1>
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '24px' }}>
          Connect a switch via USB serial cable, optionally with a Mist session for troubleshooting checks.
        </p>

        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
          {(['console', 'mist', 'extension'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              style={{
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '5px',
                border: '1px solid var(--color-border)',
                background: tab === t ? 'var(--color-accent)' : 'var(--color-surface-2)',
                color: tab === t ? '#fff' : 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === 'console' && (
          <form onSubmit={handleConsoleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: 0 }}>
              Opens a serial console terminal. No Mist credentials needed — you will be prompted
              to select the USB serial port after clicking Open Console.
            </p>
            <div>
              <label style={labelStyle}>Device Label <span style={{ fontWeight: 400 }}>(optional)</span></label>
              <input
                style={inputStyle}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. ex2300-closet-1"
              />
            </div>
            <button type="submit" style={submitStyle}>Open Console</button>
          </form>
        )}

        {tab === 'mist' && (
          <form onSubmit={handleMistSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Device MAC Address *</label>
              <input style={inputStyle} value={mac} onChange={(e) => setMac(e.target.value)} placeholder="xx:xx:xx:xx:xx:xx" />
            </div>
            <div>
              <label style={labelStyle}>Device Hostname</label>
              <input style={inputStyle} value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label style={labelStyle}>Mist Cloud *</label>
              <select style={inputStyle} value={cloud} onChange={(e) => setCloud(e.target.value as MistCloud)}>
                {MIST_CLOUDS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>CSRF Token *</label>
              <input style={inputStyle} value={csrf} onChange={(e) => setCsrf(e.target.value)} placeholder="from Mist browser cookies" />
            </div>
            <div>
              <label style={labelStyle}>Session ID *</label>
              <input style={inputStyle} value={sid} onChange={(e) => setSid(e.target.value)} placeholder="from Mist browser cookies" />
            </div>
            {error && <p style={{ fontSize: '12px', color: 'var(--color-fail)', margin: 0 }}>{error}</p>}
            <button type="submit" style={submitStyle}>Start Session</button>
          </form>
        )}

        {tab === 'extension' && (
          <form onSubmit={handleExtensionSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: 0 }}>
              Install the Marvis Console Chrome extension, then paste its Extension ID below.
              The extension will automatically inject Mist session credentials.
            </p>
            <div>
              <label style={labelStyle}>Extension ID</label>
              <input style={inputStyle} value={extId} onChange={(e) => setExtId(e.target.value)} placeholder="abcdefghijklmnopqrstuvwxyzabcdef" />
            </div>
            {error && (
              <p style={{ fontSize: '12px', color: error.startsWith('Extension ID saved') ? 'var(--color-pass)' : 'var(--color-fail)', margin: 0 }}>
                {error}
              </p>
            )}
            <button type="submit" style={submitStyle}>Save Extension ID</button>
          </form>
        )}
      </div>
    </div>
  );
}
