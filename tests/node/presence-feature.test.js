import test from 'node:test';
import assert from 'node:assert/strict';

import { presenceFeature } from '../../src/client/application/app-shell/presence-feature.js';

function createBadge() {
  return {
    style: {},
    textContent: '',
  };
}

test('presenceFeature follows remote editor viewport before cursor fallback', () => {
  let scrollToViewportCalls = 0;
  let scrollToCursorCalls = 0;

  const context = {
    ...presenceFeature,
    currentFilePath: 'README.md',
    followedCursorSignature: '',
    isExcalidrawFile: () => false,
    resolveFileClientId: () => 7,
    session: {
      getUserCursor: () => ({ cursorAnchor: 90, cursorHead: 120, cursorLine: 8 }),
      getUserViewport: () => ({ topLine: 42, viewportRatio: 0.35 }),
      scrollToLine() {
        throw new Error('unexpected scrollToLine fallback');
      },
      scrollToPosition() {
        throw new Error('unexpected scrollToPosition fallback');
      },
      scrollToUserCursor() {
        scrollToCursorCalls += 1;
        return false;
      },
      scrollToUserViewport() {
        scrollToViewportCalls += 1;
        return true;
      },
    },
  };

  context.followUserCursor({ clientId: 'global-1', peerId: 'peer-1' }, { force: true });

  assert.equal(scrollToViewportCalls, 1);
  assert.equal(scrollToCursorCalls, 0);
  assert.match(context.followedCursorSignature, /^global-1:42:/);
});

test('presenceFeature routes excalidraw follow through the embed controller', async () => {
  const calls = [];
  const context = {
    ...presenceFeature,
    currentFilePath: 'diagram.excalidraw',
    followedCursorSignature: '',
    followedUserClientId: 'global-2',
    excalidrawEmbed: {
      async setFollowedUser(filePath, peerId) {
        calls.push({ filePath, peerId });
        return true;
      },
    },
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
  };

  context.followUserCursor({ clientId: 'global-2', peerId: 'peer-2' }, { force: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [{
    filePath: 'diagram.excalidraw',
    peerId: 'peer-2',
  }]);
  assert.equal(context.followedCursorSignature, 'excalidraw:diagram.excalidraw:peer-2');
});

test('presenceFeature leaves Excalidraw follow retryable when the embed controller is not ready', async () => {
  const context = {
    ...presenceFeature,
    currentFilePath: 'diagram.excalidraw',
    followedCursorSignature: '',
    followedUserClientId: 'global-3',
    excalidrawEmbed: {
      async setFollowedUser() {
        return false;
      },
    },
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
  };

  context.followUserCursor({ clientId: 'global-3', peerId: 'peer-3' }, { force: true });
  await Promise.resolve();

  assert.equal(context.followedCursorSignature, '');
});

test('presenceFeature renders lobby presence on the empty workspace when no editor session exists', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'disconnected', unreachable: false },
    currentFilePath: null,
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: null,
  };

  context.renderPresence();

  assert.equal(badge.textContent, '1 online');
  assert.equal(badge.style.opacity, '1');
});

test('presenceFeature renders lobby presence for excalidraw routes without a markdown editor session', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'disconnected', unreachable: false },
    currentFilePath: 'diagram.excalidraw',
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: null,
  };

  context.renderPresence();

  assert.equal(badge.textContent, '1 online');
  assert.equal(badge.style.opacity, '1');
});

test('presenceFeature renders lobby presence for drawio routes without a markdown editor session', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'disconnected', unreachable: false },
    currentFilePath: 'diagram.drawio',
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    isDrawioFile: (filePath) => filePath.endsWith('.drawio'),
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: null,
  };

  context.renderPresence();

  assert.equal(badge.textContent, '1 online');
  assert.equal(badge.style.opacity, '1');
});

test('presenceFeature still prioritizes editor session connection state for markdown files', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'connecting', unreachable: true },
    currentFilePath: 'README.md',
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    isExcalidrawFile: () => false,
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: {},
  };

  context.renderPresence();

  assert.equal(badge.textContent, 'Unreachable');
  assert.equal(badge.style.opacity, '0.6');
});
