import { spawn } from 'child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;
const targetHost = process.env.TUNNEL_TARGET_HOST || process.env.HOST || '127.0.0.1';
const targetPort = process.env.TUNNEL_TARGET_PORT || process.env.PORT || '1234';
const targetUrl = process.env.TUNNEL_TARGET_URL || `http://${targetHost}:${targetPort}`;
const localHealthUrl = `${targetUrl.replace(/\/$/, '')}/health`;

let shuttingDown = false;
let buildProcess = null;
let serverProcess = null;
let tunnelProcess = null;
let forceExitTimer = null;

function spawnLoggedProcess(command, args, label, extraEnv = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`[${label}] Failed to start:`, error.message);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${label}] Exited unexpectedly with ${reason}`);
    shutdown(code ?? 1);
  });

  return child;
}

async function waitForHealthcheck(url, timeoutMs = 20000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting until the server is reachable.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for local server at ${url}`);
}

function terminateChild(child, signal = 'SIGINT') {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onExit = () => {
      child.off('exit', onExit);
      resolve();
    };

    child.on('exit', onExit);
    child.kill(signal);
  });
}

async function shutdown(exitCode = 0, signal = 'SIGINT') {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[start:tunnel] Received ${signal}, shutting down`);

  forceExitTimer = setTimeout(() => {
    buildProcess?.kill('SIGKILL');
    tunnelProcess?.kill('SIGKILL');
    serverProcess?.kill('SIGKILL');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();

  await Promise.all([
    terminateChild(buildProcess, signal),
    terminateChild(tunnelProcess, signal),
    terminateChild(serverProcess, signal),
  ]);

  clearTimeout(forceExitTimer);
  process.exit(exitCode);
}

process.once('SIGINT', () => {
  void shutdown(0, 'SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown(0, 'SIGTERM');
});

console.log('[start:tunnel] Building client assets');

buildProcess = spawn(npmCommand, ['run', 'build'], {
  env: process.env,
  stdio: 'inherit',
});

buildProcess.on('error', (error) => {
  console.error('[start:tunnel] Failed to run build:', error.message);
  process.exit(1);
});

buildProcess.on('exit', async (code) => {
  buildProcess = null;

  if (shuttingDown) {
    return;
  }

  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }

  console.log(`[start:tunnel] Starting local server on ${targetUrl}`);
  serverProcess = spawnLoggedProcess(nodeCommand, ['src/server/index.js'], 'server');

  try {
    await waitForHealthcheck(localHealthUrl);
  } catch (error) {
    console.error(`[start:tunnel] ${error.message}`);
    await shutdown(1, 'SIGTERM');
    return;
  }

  console.log(`[start:tunnel] Starting Cloudflare Tunnel for ${targetUrl}`);
  tunnelProcess = spawnLoggedProcess(nodeCommand, ['scripts/cloudflare-tunnel.mjs'], 'tunnel', {
    TUNNEL_TARGET_HOST: targetHost,
    TUNNEL_TARGET_PORT: targetPort,
    TUNNEL_TARGET_URL: targetUrl,
  });
});
