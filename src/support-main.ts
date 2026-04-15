/**
 * support-main.ts — Remote support viewer / keyboard (joins operator session over WebSocket)
 */

import { TerminalComponent } from './components/terminal.component';
import { ConsoleSessionService } from './services/console-session.service';
import './styles/main.css';

const sessionInput = document.getElementById('support-session-id') as HTMLInputElement;
const btnConnect = document.getElementById('btn-support-connect') as HTMLButtonElement;
const statusEl = document.getElementById('support-status') as HTMLElement;
const wrap = document.getElementById('support-terminal-wrap') as HTMLElement;

const params = new URLSearchParams(window.location.search);
const preset = params.get('session');
if (preset) sessionInput.value = preset;

const term = new TerminalComponent(wrap);
let cs: ConsoleSessionService | null = null;

function setStatus(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  statusEl.textContent = text;
  statusEl.className = `support-status status-text ${kind}`;
}

term.onInput = (data: string) => {
  if (!cs?.isOpen || cs.clientRole !== 'support') return;
  const enc = new TextEncoder();
  cs.sendSerialTx('support', enc.encode(data));
};

btnConnect.addEventListener('click', () => {
  const sid = sessionInput.value.trim();
  if (!sid) {
    setStatus('Enter the session ID from the operator.', 'error');
    return;
  }
  cs?.close();
  term.clear();
  term.writeSystem('— Joining session… —');
  setStatus('Connecting…', 'info');

  const session = new ConsoleSessionService();
  cs = session;
  session.onJoined = () => {
    setStatus('Connected — mirrored console.', 'success');
    term.focus();
    term.writeSystem('— Connected. Output from the switch appears below. —');
  };
  session.onRemoteSerialRx = (data: Uint8Array) => {
    term.write(data);
  };
  // onRemoteOperatorTx is intentionally not written to the terminal here.
  // The Junos console echoes all typed characters back as RX data, so
  // mirroring TX as well would cause every character to appear twice.
  session.onSessionEnded = (reason: string) => {
    setStatus(`Session ended: ${reason}`, 'info');
  };
  session.onError = (msg: string) => {
    setStatus(msg, 'error');
  };
  session.startAsSupport(sid);
});
