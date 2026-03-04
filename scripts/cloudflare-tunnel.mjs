import { spawn } from 'child_process';

function getCloudflaredCommand() {
  return process.env.CLOUDFLARED_BIN || 'cloudflared';
}

function getTunnelTargetUrl() {
  if (process.env.TUNNEL_TARGET_URL) {
    return process.env.TUNNEL_TARGET_URL;
  }

  const host = process.env.TUNNEL_TARGET_HOST || process.env.HOST || '127.0.0.1';
  const port = process.env.TUNNEL_TARGET_PORT || process.env.PORT || '1234';

  return `http://${host}:${port}`;
}

function getTunnelArgs(targetUrl) {
  const customArgs = (process.env.CLOUDFLARED_EXTRA_ARGS || '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return ['tunnel', '--url', targetUrl, ...customArgs];
}

const targetUrl = getTunnelTargetUrl();
const cloudflaredCommand = getCloudflaredCommand();
const cloudflaredArgs = getTunnelArgs(targetUrl);
let shutdownStarted = false;
let forceExitTimer = null;

console.log(`[tunnel] Starting Cloudflare Tunnel for ${targetUrl}`);

const child = spawn(cloudflaredCommand, cloudflaredArgs, {
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(`[tunnel] Could not find "${cloudflaredCommand}". Install Cloudflare Tunnel first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  } else {
    console.error('[tunnel] Failed to start Cloudflare Tunnel:', error.message);
  }

  process.exit(1);
});

function shutdown(signal) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`[tunnel] Received ${signal}, shutting down`);

  if (child.exitCode === null && !child.killed) {
    child.kill(signal);
  }

  forceExitTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }

    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  if (forceExitTimer) {
    clearTimeout(forceExitTimer);
  }

  if (shutdownStarted) {
    process.exit(code ?? 0);
    return;
  }

  if (signal) {
    console.error(`[tunnel] Cloudflare Tunnel exited from signal ${signal}`);
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});
