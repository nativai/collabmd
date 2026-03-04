#!/usr/bin/env node

import { createServer } from 'http';

import { loadConfig } from './config/env.js';
import { CollaborationRoom } from './domain/collaboration/collaboration-room.js';
import { RoomRegistry } from './domain/collaboration/room-registry.js';
import { createRequestHandler } from './infrastructure/http/create-request-handler.js';
import { FileRoomStore } from './infrastructure/persistence/file-room-store.js';
import { attachCollaborationGateway } from './infrastructure/websocket/attach-collaboration-gateway.js';

const config = loadConfig();
const roomStore = new FileRoomStore({ directory: config.persistenceDir });
const roomRegistry = new RoomRegistry({
  createRoom: ({ name, onEmpty }) =>
    new CollaborationRoom({
      name,
      docNamespace: config.roomNamespace,
      onEmpty,
      persistenceStore: roomStore,
    }),
});
const requestHandler = createRequestHandler(config);

const httpServer = createServer((req, res) => {
  requestHandler(req, res).catch((error) => {
    console.error('[http] Unhandled request error:', error.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal Server Error');
  });
});

const collaborationGateway = attachCollaborationGateway({
  httpServer,
  roomRegistry,
  wsBasePath: config.wsBasePath,
});

function getDisplayHost(host) {
  return host === '127.0.0.1' ? 'localhost' : host;
}

let shutdownPromise = null;

async function closeHttpServer() {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    if (typeof httpServer.closeIdleConnections === 'function') {
      httpServer.closeIdleConnections();
    }
  });
}

function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  console.log(`[server] Received ${signal}, shutting down`);

  const forceExitTimer = setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();

  shutdownPromise = Promise.all([
    collaborationGateway.close(),
    closeHttpServer(),
  ])
    .then(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    })
    .catch((error) => {
      clearTimeout(forceExitTimer);
      console.error('[server] Shutdown error:', error.message);
      process.exit(1);
    });

  return shutdownPromise;
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

httpServer.listen(config.port, config.host, () => {
  console.log('');
  console.log('  CollabMD Collaboration Server');
  console.log(`  http://${getDisplayHost(config.host)}:${config.port}`);
  console.log(`  ws route: ${config.wsBasePath}/:room`);
  console.log(`  persistence: ${config.persistenceDir}`);
  console.log('');
});
