export interface ServerConfig {
  readonly port: number;
  readonly mistProxyTimeoutMs: number;
}

export function loadConfig(): ServerConfig {
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const mistProxyTimeoutMs = parseInt(process.env['MIST_PROXY_TIMEOUT'] ?? '30000', 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env['PORT']}`);
  }
  if (isNaN(mistProxyTimeoutMs) || mistProxyTimeoutMs < 1000) {
    throw new Error(`Invalid MIST_PROXY_TIMEOUT: ${process.env['MIST_PROXY_TIMEOUT']}`);
  }

  return { port, mistProxyTimeoutMs };
}
