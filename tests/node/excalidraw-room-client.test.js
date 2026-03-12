import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import { buildExcalidrawRoomScene } from '../../src/domain/excalidraw-room-codec.js';
import { ExcalidrawRoomClient } from '../../src/client/infrastructure/excalidraw-room-client.js';

function createFakeAwareness() {
  const states = new Map();
  return {
    clientID: 1,
    getStates() {
      return states;
    },
    off() {},
    on() {},
    setLocalState(value) {
      this.localState = value;
    },
    setLocalStateField(key, value) {
      this.localState = {
        ...(this.localState || {}),
        [key]: value,
      };
      states.set(1, this.localState);
    },
  };
}

function createFakeProvider() {
  const listeners = new Map();
  return {
    awareness: createFakeAwareness(),
    destroy() {
      this.destroyed = true;
    },
    disconnect() {
      this.disconnected = true;
    },
    off(type, handler) {
      listeners.delete(`${type}:${handler}`);
    },
    on(type, handler) {
      listeners.set(`${type}:${handler}`, handler);
    },
    synced: true,
  };
}

function createScene(elementId, {
  color = '#ffffff',
} = {}) {
  return JSON.stringify({
    appState: {
      gridSize: null,
      viewBackgroundColor: color,
    },
    elements: [{
      id: elementId,
      isDeleted: false,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
}

function parseElements(sceneJson) {
  return JSON.parse(sceneJson).elements.map((element) => element.id);
}

async function createConnectedClient({
  historyLimit,
  historyCaptureWindowMs,
  now = () => Date.now(),
  onRemoteSceneJson = () => {},
} = {}) {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    historyCaptureWindowMs,
    historyLimit,
    now,
    onRemoteSceneJson,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  return { client, provider, ydoc };
}

test('ExcalidrawRoomClient uses an empty scene when no file path is configured', async () => {
  const client = new ExcalidrawRoomClient({ vaultClient: {} });

  const scene = await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  assert.equal(scene.type, 'excalidraw');
  assert.match(client.getLastSceneJson(), /"type":"excalidraw"/);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: false,
    head: null,
    length: null,
  });
});

test('ExcalidrawRoomClient syncs local scene updates into the structured room state', async () => {
  const remoteScenes = [];
  const { client, ydoc } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  client.scheduleSceneSync(
    [{ id: 'shape-1', isDeleted: false }],
    { gridSize: 12, viewBackgroundColor: '#abcdef' },
    {},
  );

  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id), ['shape-1']);
  assert.match(client.getLastSceneJson(), /shape-1/);
  assert.deepEqual(remoteScenes, []);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: false,
    head: null,
    length: null,
  });
});

test('ExcalidrawRoomClient commitSceneJson writes the latest scene without tracking room history', async () => {
  const { client, ydoc } = await createConnectedClient();

  assert.equal(client.commitSceneJson(createScene('shape-1', { color: '#111111' }), { origin: 'test-1' }), true);
  assert.equal(client.commitSceneJson(createScene('shape-2', { color: '#222222' }), { origin: 'test-2' }), true);

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-2']);
  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id), ['shape-2']);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: false,
    head: null,
    length: null,
  });
});

test('ExcalidrawRoomClient avoids rewriting the room when the scene is unchanged', async () => {
  const { client, ydoc } = await createConnectedClient();

  assert.equal(client.commitSceneJson(createScene('shape-1'), { origin: 'test-1' }), true);
  const updateBaseline = Y.encodeStateAsUpdate(ydoc);

  assert.equal(client.commitSceneJson(createScene('shape-1'), { origin: 'test-1-repeat' }), false);
  assert.deepEqual(Array.from(Y.encodeStateAsUpdate(ydoc)), Array.from(updateBaseline));
});

test('ExcalidrawRoomClient updates awareness fields for local user, pointer, and selection state', async () => {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();

  const rafCallbacks = [];
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    requestAnimationFrameFn: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  client.setLocalUser({ name: 'Updated Name' });
  client.syncLocalSelectionAwareness({ selectedElementIds: { shapeA: true } });
  client.scheduleLocalPointerAwareness({ button: 'down', pointer: { tool: 'laser', x: 10, y: 20 } });
  client.scheduleLocalViewportAwareness({ scrollX: 12, scrollY: 34, zoom: 1.5 });
  rafCallbacks[0]();
  rafCallbacks[1]();

  assert.equal(provider.awareness.localState.user.name, 'Updated Name');
  assert.deepEqual(provider.awareness.localState.selectedElementIds, { shapeA: true });
  assert.deepEqual(provider.awareness.localState.pointer, { tool: 'laser', x: 10, y: 20 });
  assert.equal(provider.awareness.localState.pointerButton, 'down');
  assert.deepEqual(provider.awareness.localState.viewport, { scrollX: 12, scrollY: 34, zoom: 1.5 });
});

test('ExcalidrawRoomClient rereads the file after a create conflict instead of falling back to an empty scene', async () => {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  let readCount = 0;

  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async createFile() {
        const error = new Error('File already exists');
        error.status = 409;
        throw error;
      },
      async readFile() {
        readCount += 1;
        if (readCount === 1) {
          const error = new Error('File not found');
          error.status = 404;
          throw error;
        }

        return { content: createScene('shape-existing') };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  const scene = await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  assert.deepEqual(scene.elements.map((element) => element.id), ['shape-existing']);
});

test('ExcalidrawRoomClient delays transient empty scene commits during active collaboration', async () => {
  let currentTime = 1000;
  const timers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();

  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    now: () => currentTime,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  provider.awareness.getStates().set(2, {
    user: { color: '#222222', colorLight: '#22222233', name: 'Remote', peerId: 'peer-2' },
  });

  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });
  client.scheduleSceneSync([], { gridSize: null, viewBackgroundColor: '#ffffff' }, {});
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);
  assert.equal(timers.length, 1);

  client.scheduleSceneSync([{ id: 'shape-2', isDeleted: false }], { gridSize: null, viewBackgroundColor: '#ffffff' }, {});
  currentTime += 25;
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-2']);
});

test('ExcalidrawRoomClient still allows an empty scene commit after the guard window elapses', async () => {
  let currentTime = 1000;
  const timers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();

  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    emptySceneGuardMs: 200,
    now: () => currentTime,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  provider.awareness.getStates().set(2, {
    user: { color: '#222222', colorLight: '#22222233', name: 'Remote', peerId: 'peer-2' },
  });

  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });
  client.scheduleSceneSync([], { gridSize: null, viewBackgroundColor: '#ffffff' }, {});
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);
  assert.equal(timers.length, 1);

  currentTime += 250;
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), []);
});

test('ExcalidrawRoomClient ignores malformed legacy room text when structured state is authoritative', async () => {
  const remoteScenes = [];
  const { client, ydoc } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });
  const before = client.getLastSceneJson();

  ydoc.transact(() => {
    const legacyText = ydoc.getText('codemirror');
    legacyText.insert(0, '{"broken":');
  }, 'test-invalid-legacy');

  assert.equal(client.getLastSceneJson(), before);
  assert.equal(remoteScenes.length, 0);
});
