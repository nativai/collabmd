import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import {
  applySceneDiffToExcalidrawRoom,
  buildExcalidrawRoomScene,
  isExcalidrawRoomDocStructured,
  migrateLegacyExcalidrawRoomData,
  readLegacyExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
} from '../../src/domain/excalidraw-room-codec.js';

function createElement(id, {
  index = 'a0',
  isDeleted = false,
  version = 1,
  versionNonce = 1,
  x = 0,
  y = 0,
} = {}) {
  return {
    angle: 0,
    backgroundColor: 'transparent',
    boundElements: null,
    fillStyle: 'hachure',
    frameId: null,
    groupIds: [],
    height: 80,
    id,
    index,
    isDeleted,
    link: null,
    locked: false,
    opacity: 100,
    roughness: 1,
    roundness: null,
    seed: 1,
    strokeColor: '#1e1e1e',
    strokeStyle: 'solid',
    strokeWidth: 1,
    type: 'rectangle',
    updated: version * 1000,
    version,
    versionNonce,
    width: 120,
    x,
    y,
  };
}

function createScene(elements) {
  return {
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements,
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  };
}

function syncDocs(from, to) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
}

test('migrates legacy codemirror scene content into structured Excalidraw room state', () => {
  const doc = new Y.Doc();
  const legacyScene = JSON.stringify(createScene([createElement('shape-legacy')]));
  doc.getText('codemirror').insert(0, legacyScene);

  assert.equal(isExcalidrawRoomDocStructured(doc), false);

  const parsedLegacyScene = readLegacyExcalidrawRoomScene(doc);
  assert.ok(parsedLegacyScene);
  migrateLegacyExcalidrawRoomData(doc, parsedLegacyScene);

  assert.equal(isExcalidrawRoomDocStructured(doc), true);
  assert.deepEqual(buildExcalidrawRoomScene(doc).elements.map((element) => element.id), ['shape-legacy']);
});

test('merges concurrent structured updates for different elements into one valid scene', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  replaceExcalidrawRoomScene(docA, createScene([]));
  syncDocs(docA, docB);
  syncDocs(docB, docA);

  docA.transact(() => {
    applySceneDiffToExcalidrawRoom(docA, createScene([createElement('shape-a', { index: 'a1', x: 10 })]));
  }, 'client-a');
  docB.transact(() => {
    applySceneDiffToExcalidrawRoom(docB, createScene([createElement('shape-b', { index: 'a2', x: 30 })]));
  }, 'client-b');

  syncDocs(docA, docB);
  syncDocs(docB, docA);

  const sceneA = buildExcalidrawRoomScene(docA);
  const sceneB = buildExcalidrawRoomScene(docB);
  assert.deepEqual(sceneA.elements.map((element) => element.id), ['shape-a', 'shape-b']);
  assert.deepEqual(sceneB.elements.map((element) => element.id), ['shape-a', 'shape-b']);
});

test('keeps the higher element version and versionNonce when concurrent edits target the same element', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const baseScene = createScene([createElement('shared-shape', { version: 1, versionNonce: 1, x: 0 })]);

  replaceExcalidrawRoomScene(docA, baseScene);
  syncDocs(docA, docB);
  syncDocs(docB, docA);

  docA.transact(() => {
    applySceneDiffToExcalidrawRoom(docA, createScene([
      createElement('shared-shape', { version: 2, versionNonce: 4, x: 20 }),
    ]));
  }, 'client-a');
  docB.transact(() => {
    applySceneDiffToExcalidrawRoom(docB, createScene([
      createElement('shared-shape', { version: 2, versionNonce: 9, x: 45 }),
    ]));
  }, 'client-b');

  syncDocs(docA, docB);
  syncDocs(docB, docA);

  const [winningElement] = buildExcalidrawRoomScene(docA).elements;
  assert.equal(winningElement.id, 'shared-shape');
  assert.equal(winningElement.version, 2);
  assert.equal(winningElement.versionNonce, 9);
  assert.equal(winningElement.x, 45);
});
