import { WebSocketServer } from 'ws';

function rejectUpgrade(socket, statusCode, statusMessage) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n\r\n`);
  socket.destroy();
}

function extractRoomName(pathname, wsBasePath) {
  const roomSegment = pathname.slice(wsBasePath.length + 1);
  return decodeURIComponent(roomSegment || 'default');
}

export function attachCollaborationGateway({
  heartbeatIntervalMs,
  httpServer,
  maxPayload,
  roomRegistry,
  wsBasePath,
}) {
  const websocketServer = new WebSocketServer({
    maxPayload,
    noServer: true,
    perMessageDeflate: false,
  });
  let isShuttingDown = false;
  let closePromise = null;
  const heartbeatTimer = setInterval(() => {
    websocketServer.clients.forEach((client) => {
      if (client.isAlive === false) {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while collecting dead clients.
        }
        return;
      }

      client.isAlive = false;

      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while pinging clients.
        }
      }
    });
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  websocketServer.on('connection', (ws, req, requestUrl) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    void (async () => {
      const roomName = extractRoomName(requestUrl.pathname, wsBasePath);
      const room = roomRegistry.getOrCreate(roomName);

      try {
        await room.addClient(ws);
      } catch (error) {
        console.error(`[ws] Failed to initialize room "${roomName}":`, error.message);
        ws.close(1011, 'Room initialization failed');
        return;
      }

      console.log(`[ws] "${roomName}" connected (${room.clients.size} active client(s))`);

      ws.on('message', (payload) => room.handleMessage(ws, payload));
      ws.on('close', () => {
        room.removeClient(ws);
        const remaining = roomRegistry.rooms.get(roomName)?.clients.size ?? 0;
        console.log(`[ws] "${roomName}" disconnected (${remaining} active client(s))`);
      });
      ws.on('error', (error) => {
        console.error(`[ws] "${roomName}" socket error:`, error.message);
      });
    })();
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (isShuttingDown) {
      rejectUpgrade(socket, 503, 'Server Shutting Down');
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const matchesRealtimeRoute =
      requestUrl.pathname === wsBasePath || requestUrl.pathname.startsWith(`${wsBasePath}/`);

    if (!matchesRealtimeRoute || requestUrl.pathname === wsBasePath) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    websocketServer.handleUpgrade(req, socket, head, (ws) => {
      websocketServer.emit('connection', ws, req, requestUrl);
    });
  });

  async function close() {
    if (closePromise) {
      return closePromise;
    }

    isShuttingDown = true;
    clearInterval(heartbeatTimer);

    closePromise = new Promise((resolve, reject) => {
      const forceCloseTimer = setTimeout(() => {
        websocketServer.clients.forEach((client) => {
          try {
            client.terminate();
          } catch {
            // Ignore termination errors during forced shutdown.
          }
        });
      }, 1000);
      forceCloseTimer.unref?.();

      websocketServer.close((error) => {
        clearTimeout(forceCloseTimer);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      websocketServer.clients.forEach((client) => {
        try {
          client.close(1001, 'Server shutting down');
        } catch {
          // Ignore close errors during shutdown.
        }
      });
    });

    return closePromise;
  }

  return {
    close,
    websocketServer,
  };
}
