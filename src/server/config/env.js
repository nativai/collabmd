import { resolve } from 'path';
import { fileURLToPath } from 'url';

function parsePositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parsePort(rawPort, fallbackPort) {
  return parsePositiveInt(rawPort, fallbackPort);
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') {
    return '/ws';
  }

  const trimmed = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function getDefaultHost(nodeEnv) {
  return nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
}

export function loadConfig(overrides = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const vaultDir = overrides.vaultDir
    || process.env.COLLABMD_VAULT_DIR
    || resolve(projectRoot, 'data/vault');

  return {
    host: process.env.HOST || getDefaultHost(nodeEnv),
    httpHeadersTimeoutMs: parsePositiveInt(process.env.HTTP_HEADERS_TIMEOUT_MS, 60_000),
    httpKeepAliveTimeoutMs: parsePositiveInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000),
    httpRequestTimeoutMs: parsePositiveInt(process.env.HTTP_REQUEST_TIMEOUT_MS, 30_000),
    port: parsePort(process.env.PORT, 1234),
    nodeEnv,
    publicDir: resolve(projectRoot, 'public'),
    vaultDir,
    publicWsBaseUrl: process.env.PUBLIC_WS_BASE_URL || '',
    wsHeartbeatIntervalMs: parsePositiveInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 30_000),
    wsBasePath: normalizeBasePath(process.env.WS_BASE_PATH || '/ws'),
    wsMaxBufferedAmountBytes: parsePositiveInt(
      process.env.WS_MAX_BUFFERED_AMOUNT_BYTES,
      1_048_576,
    ),
    wsMaxPayloadBytes: parsePositiveInt(process.env.WS_MAX_PAYLOAD_BYTES, 4_194_304),
  };
}
