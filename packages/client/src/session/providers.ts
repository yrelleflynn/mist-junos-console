import type { MistSession, MistCloud } from '@marvis/shared';
import { MIST_CLOUDS } from '@marvis/shared';

// --- Extension provider ---

interface ExtensionResponse {
  csrfToken: string;
  sessionId: string;
  cloud: MistCloud;
}

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          callback: (response: unknown) => void,
        ) => void;
      };
    };
  }
}

const EXTENSION_ID_KEY = 'marvis_extension_id';

function getExtensionId(): string | null {
  return localStorage.getItem(EXTENSION_ID_KEY);
}

function fromExtension(): Promise<MistSession | null> {
  return new Promise((resolve) => {
    const id = getExtensionId();
    if (!id || !window.chrome?.runtime?.sendMessage) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), 1000);
    window.chrome.runtime.sendMessage(id, { type: 'get-mist-session' }, (response) => {
      clearTimeout(timer);
      const r = response as ExtensionResponse | null;
      if (!r?.csrfToken || !r.sessionId || !r.cloud) {
        resolve(null);
        return;
      }
      resolve({
        cloud: r.cloud,
        csrfToken: r.csrfToken,
        sessionId: r.sessionId,
        acquiredAt: Math.floor(Date.now() / 1000),
      });
    });
  });
}

// --- URL params provider ---

function fromUrlParams(): MistSession | null {
  const params = new URLSearchParams(location.search);
  const cloud = params.get('cloud') as MistCloud | null;
  const csrfToken = params.get('csrf');
  const sessionId = params.get('sid');

  if (!cloud || !csrfToken || !sessionId) return null;
  const known = MIST_CLOUDS.find((c) => c.id === cloud);
  if (!known) return null;

  return { cloud, csrfToken, sessionId, acquiredAt: Math.floor(Date.now() / 1000) };
}

// --- Manual provider (form values passed in) ---

export function buildManualSession(
  cloud: MistCloud,
  csrfToken: string,
  sessionId: string,
): MistSession {
  return { cloud, csrfToken, sessionId, acquiredAt: Math.floor(Date.now() / 1000) };
}

// --- Auto-detect ---

export async function detectSession(): Promise<MistSession | null> {
  const fromExt = await fromExtension();
  if (fromExt) return fromExt;
  return fromUrlParams();
}

export function saveExtensionId(id: string): void {
  localStorage.setItem(EXTENSION_ID_KEY, id);
}
