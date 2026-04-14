/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional; dev WebSocket backend port (default 3333). Set in `.env.development` if needed. */
  readonly VITE_CONSOLE_SERVER_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
