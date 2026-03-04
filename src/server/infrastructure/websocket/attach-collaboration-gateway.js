import { WebSocketServer } from 'ws';

function rejectUpgrade(socket, statusCode, statusMessage) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n\r\n`);
  socket.destroy();
}

function extractRoomName(pathname, wsBasePath) {
  const roomSegment = pathname.slice(wsBasePath.length + 1);
  return decodeURIComponent(roomSegment || 'default');
}

export function attachCollaborationGateway({ httpServer, roomRegistry, wsBasePath }) {
  const websocketServer = new WebSocketServer({ noServer: true });

  websocketServer.on('connection', (ws, req, requestUrl) => {
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

  return websocketServer;
}
