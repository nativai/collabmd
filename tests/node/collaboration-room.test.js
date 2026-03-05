import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';

function createSocket({ bufferedAmount = 0 } = {}) {
  return {
    OPEN: 1,
    backpressureCloseIssued: false,
    bufferedAmount,
    closeCalls: [],
    readyState: 1,
    sent: [],
    send(payload, callback) {
      this.sent.push(payload);
      callback?.();
    },
    close(code, reason) {
      this.closeCalls.push({ code, reason });
      this.readyState = 2;
    },
    terminate() {
      this.readyState = 3;
    },
  };
}

test('CollaborationRoom hydrates once for concurrent joins', async () => {
  let readCount = 0;
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'hydration-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readMarkdownFile() {
        readCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return '# persisted';
      },
      async writeMarkdownFile() {},
    },
  });

  await Promise.all([room.addClient(createSocket()), room.addClient(createSocket())]);

  assert.equal(readCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), '# persisted');
});

test('CollaborationRoom closes slow clients when buffered writes exceed the limit', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 4,
    name: 'backpressure-room',
    onEmpty: () => {},
    vaultFileStore: null,
  });

  const origin = createSocket();
  const slowClient = createSocket();

  await room.addClient(origin);
  await room.addClient(slowClient);

  const sentCountBeforeBroadcast = slowClient.sent.length;
  slowClient.bufferedAmount = 10;

  const clientDoc = new Y.Doc();
  clientDoc.getText('codemirror').insert(0, 'hello');
  Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(clientDoc), origin);

  assert.equal(slowClient.sent.length, sentCountBeforeBroadcast);
  assert.equal(slowClient.closeCalls.length, 1);
  assert.deepEqual(slowClient.closeCalls[0], {
    code: 1013,
    reason: 'Client too slow',
  });
});
