import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import WebSocket from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { MSG_AWARENESS, MSG_SYNC } from '../../src/server/domain/collaboration/protocol.js';
import { startTestServer, waitForCondition } from './helpers/test-server.js';

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForClose(socket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve({ code: 1005, reason: '' });
  }

  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({
        code,
        reason: reason.toString(),
      });
    });
  });
}

function waitForMessage(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', handleMessage);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for websocket message`));
    }, timeoutMs);

    function handleMessage(payload) {
      const data = payload instanceof Buffer ? new Uint8Array(payload) : new Uint8Array(payload);
      if (!predicate(data)) {
        return;
      }

      clearTimeout(timer);
      socket.off('message', handleMessage);
      resolve(data);
    }

    socket.on('message', handleMessage);
  });
}

function getMessageType(data) {
  const decoder = decoding.createDecoder(data);
  return decoding.readVarUint(decoder);
}

function encodeAwarenessMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

function encodeSyncUpdateMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

test('WebSocket collaboration broadcasts awareness and persists vault file', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  // Connect two clients to the seeded test.md file
  const filePath = 'test.md';
  const ws1 = new WebSocket(app.wsUrl(filePath));
  const ws2 = new WebSocket(app.wsUrl(filePath));
  t.after(async () => {
    ws1.close();
    ws2.close();
    await Promise.allSettled([waitForClose(ws1), waitForClose(ws2)]);
  });

  await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
  await Promise.all([
    waitForMessage(ws1, (data) => getMessageType(data) === MSG_SYNC),
    waitForMessage(ws2, (data) => getMessageType(data) === MSG_SYNC),
  ]);

  // Client 1 sends awareness state
  const awareness = new awarenessProtocol.Awareness(new Y.Doc());
  awareness.setLocalStateField('user', {
    color: '#0ea5e9',
    colorLight: '#0ea5e933',
    name: 'Integration User',
  });
  ws1.send(encodeAwarenessMessage(
    awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
  ));

  // Client 2 should receive the awareness broadcast
  const awarenessMessage = await waitForMessage(ws2, (data) => getMessageType(data) === MSG_AWARENESS);
  const awarenessDecoder = decoding.createDecoder(awarenessMessage);
  decoding.readVarUint(awarenessDecoder);
  const remoteAwareness = new awarenessProtocol.Awareness(new Y.Doc());
  awarenessProtocol.applyAwarenessUpdate(
    remoteAwareness,
    decoding.readVarUint8Array(awarenessDecoder),
    'test',
  );
  assert.equal(remoteAwareness.getStates().get(awareness.clientID)?.user?.name, 'Integration User');

  // Client 1 sends a document update
  const clientDoc = new Y.Doc();
  clientDoc.getText('codemirror').insert(0, '# Persisted from test');
  ws1.send(encodeSyncUpdateMessage(Y.encodeStateAsUpdate(clientDoc)));

  // Client 2 should receive the sync update
  await waitForMessage(ws2, (data) => getMessageType(data) === MSG_SYNC);

  // Close both clients
  ws1.close();
  ws2.close();
  await Promise.all([waitForClose(ws1), waitForClose(ws2)]);

  // Wait for the room to drain
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  // The vault file store persists plain text to disk — verify it
  const diskContent = await waitForCondition(async () => {
    const content = await readFile(join(app.vaultDir, filePath), 'utf-8');
    return content.includes('Persisted from test') ? content : null;
  });

  assert.ok(diskContent.includes('# Persisted from test'));
});

test('WebSocket server rejects oversized payloads', async (t) => {
  const app = await startTestServer({
    wsMaxPayloadBytes: 128,
  });
  t.after(() => app.close());

  const ws = new WebSocket(app.wsUrl('test.md'));
  t.after(async () => {
    ws.close();
    await Promise.allSettled([waitForClose(ws)]);
  });

  await waitForOpen(ws);
  await waitForMessage(ws, (data) => getMessageType(data) === MSG_SYNC);

  ws.send(Buffer.alloc(1024, 1));

  const closeEvent = await waitForClose(ws);
  assert.equal(closeEvent.code, 1009);
});
