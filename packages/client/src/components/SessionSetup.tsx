import { useState } from 'react';
import type { MistCloud, MistSession } from '@marvis/shared';
import { MIST_CLOUDS } from '@marvis/shared';
import { buildManualSession, saveExtensionId } from '../session/providers.js';

interface SessionSetupProps {
  onComplete: (mac: string, session: MistSession, hostname?: string) => void;
}

export function SessionSetup({ onComplete }: SessionSetupProps) {
  const [tab, setTab] = useState<'manual' | 'extension'>('manual');
  const [mac, setMac] = useState('');
  const [hostname, setHostname] = useState('');
  const [cloud, setCloud] = useState<MistCloud>('global01');
  const [csrf, setCsrf] = useState('');
  const [sid, setSid] = useState('');
  const [extId, setExtId] = useState('');
  const [error, setError] = useState('');

  function handleManualSubmit(e: React.FormEvent) {
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
          Connect a device session to begin troubleshooting.
        </p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['manual', 'extension'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '5px 14px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '5px',
                border: '1px solid var(--color-border)',
                background: tab === t ? 'var(--color-accent)' : 'var(--color-surface-2)',
                color: tab === t ? '#fff' : 'var(--color-text-muted)',
              }}
            >
              {t === 'manual' ? 'Manual' : 'Extension'}
            </button>
          ))}
        </div>

        {tab === 'manual' && (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
            {error && <p style={{ fontSize: '12px', color: 'var(--color-fail)' }}>{error}</p>}
            <button
              type="submit"
              style={{
                padding: '9px',
                fontSize: '13px',
                fontWeight: 600,
                background: 'var(--color-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                marginTop: '4px',
              }}
            >
              Start Session
            </button>
          </form>
        )}

        {tab === 'extension' && (
          <form onSubmit={handleExtensionSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Install the Marvis Console Chrome extension, then paste its Extension ID below.
              The extension will automatically inject Mist session credentials.
            </p>
            <div>
              <label style={labelStyle}>Extension ID</label>
              <input style={inputStyle} value={extId} onChange={(e) => setExtId(e.target.value)} placeholder="abcdefghijklmnopqrstuvwxyzabcdef" />
            </div>
            {error && (
              <p style={{ fontSize: '12px', color: error.startsWith('Extension ID saved') ? 'var(--color-pass)' : 'var(--color-fail)' }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              style={{
                padding: '9px',
                fontSize: '13px',
                fontWeight: 600,
                background: 'var(--color-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
              }}
            >
              Save Extension ID
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
