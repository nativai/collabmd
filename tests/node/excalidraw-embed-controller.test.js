import test from 'node:test';
import assert from 'node:assert/strict';

import { ExcalidrawEmbedController } from '../../src/client/presentation/excalidraw-embed-controller.js';

test('replays a queued follow target after the Excalidraw iframe reports ready', async () => {
  const originalWindow = globalThis.window;
  const posts = [];
  const iframeWindow = {};
  const entry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: iframeWindow },
    isReady: false,
    wrapper: {},
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#0', entry]]),
      followedPeerIdsByFilePath: new Map(),
      getTheme: () => 'dark',
      _clearEntryBootTimeout: () => {},
      _entryNeedsHardReload: () => false,
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      _findEntryByFilePath: ExcalidrawEmbedController.prototype._findEntryByFilePath,
      _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
      _postMessageToEntry: (_entry, payload) => {
        posts.push(payload);
      },
      _setEntryLoadingState: () => {},
      _syncEntryFollowState: ExcalidrawEmbedController.prototype._syncEntryFollowState,
      _syncEntryUser: () => {},
    };

    const didQueueFollow = await ExcalidrawEmbedController.prototype.setFollowedUser.call(
      controller,
      'sample-excalidraw.excalidraw',
      'peer-42',
    );

    assert.equal(didQueueFollow, true);
    assert.equal(entry.followedPeerId, 'peer-42');
    assert.deepEqual(posts, []);

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'ready',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.deepEqual(posts, [
      {
        source: 'collabmd-host',
        type: 'set-theme',
        theme: 'dark',
      },
      {
        source: 'collabmd-host',
        type: 'follow-user',
        peerId: 'peer-42',
      },
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('forwards Excalidraw quick switcher requests from known same-origin iframe', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#0', {
        filePath: 'sample-excalidraw.excalidraw',
        iframe: { contentWindow: iframeWindow },
      }]]),
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.equal(toggleCalls, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('persists follow intent even before the embed entry exists', async () => {
  const controller = {
    embedEntries: new Map(),
    followedPeerIdsByFilePath: new Map(),
    _findEntryByFilePath: () => null,
  };

  const didQueueFollow = await ExcalidrawEmbedController.prototype.setFollowedUser.call(
    controller,
    'sample-excalidraw.excalidraw',
    'peer-99',
  );

  assert.equal(didQueueFollow, true);
  assert.equal(controller.followedPeerIdsByFilePath.get('sample-excalidraw.excalidraw'), 'peer-99');
});

test('detachForCommit exits maximized mode before hiding overlay roots', () => {
  let exitCalls = 0;
  const controller = {
    _disconnectPlaceholderObserver: () => {},
    _exitMaximizedEmbed: () => {
      exitCalls += 1;
    },
    embedEntries: new Map([['sample-excalidraw.excalidraw#0', { queued: true, placeholder: { isConnected: true } }]]),
    hydrationIdleId: null,
    hydrationInProgress: true,
    hydrationQueue: ['sample-excalidraw.excalidraw#0'],
    maximizedRoot: { hidden: false },
    overlayRoot: { hidden: false },
  };

  ExcalidrawEmbedController.prototype.detachForCommit.call(controller);

  assert.equal(exitCalls, 1);
  assert.equal(controller.hydrationInProgress, false);
  assert.deepEqual(controller.hydrationQueue, []);
  assert.equal(controller.overlayRoot.hidden, true);
  assert.equal(controller.maximizedRoot.hidden, true);
  assert.equal(controller.embedEntries.get('sample-excalidraw.excalidraw#0').queued, false);
  assert.equal(controller.embedEntries.get('sample-excalidraw.excalidraw#0').placeholder, null);
});

test('reuses a warm direct-preview entry for the next direct file preview', () => {
  const warmEntry = {
    filePath: 'sample-a.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-a.excalidraw#file-preview',
    label: 'sample-a.excalidraw',
    wrapper: {},
  };
  const controller = {
    warmEntry,
    _claimEntryFromRemovedEntries: ExcalidrawEmbedController.prototype._claimEntryFromRemovedEntries,
    _claimReusableEntry: ExcalidrawEmbedController.prototype._claimReusableEntry,
    _claimWarmEntry: ExcalidrawEmbedController.prototype._claimWarmEntry,
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  };

  const reusedEntry = ExcalidrawEmbedController.prototype._claimReusableEntry.call(controller, {
    filePath: 'sample-b.excalidraw',
    key: 'sample-b.excalidraw#file-preview',
  }, []);

  assert.equal(reusedEntry, warmEntry);
  assert.equal(controller.warmEntry, null);
});

test('promotes a same-file embedded preview entry into a direct file preview', () => {
  const embeddedEntry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-excalidraw.excalidraw#0',
    label: 'sample-excalidraw.excalidraw',
    wrapper: {},
  };
  const controller = {
    warmEntry: null,
    _claimEntryFromRemovedEntries: ExcalidrawEmbedController.prototype._claimEntryFromRemovedEntries,
    _claimReusableEntry: ExcalidrawEmbedController.prototype._claimReusableEntry,
    _claimWarmEntry: ExcalidrawEmbedController.prototype._claimWarmEntry,
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  };
  const removedEntries = [embeddedEntry];

  const reusedEntry = ExcalidrawEmbedController.prototype._claimReusableEntry.call(controller, {
    filePath: 'sample-excalidraw.excalidraw',
    key: 'sample-excalidraw.excalidraw#file-preview',
  }, removedEntries);

  assert.equal(reusedEntry, embeddedEntry);
  assert.deepEqual(removedEntries, []);
});

test('treats a reused direct-preview entry with a new file path as needing reload', () => {
  const entry = {
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-next.excalidraw#file-preview',
    loadedFilePath: 'sample-prev.excalidraw',
    loadedMode: 'edit',
    wrapper: {},
  };

  const needsReload = ExcalidrawEmbedController.prototype._entryNeedsHardReload.call({
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  }, entry);

  assert.equal(needsReload, true);
});

test('does not reload again while the iframe is already booting the desired file', () => {
  const entry = {
    bootFilePath: 'sample-next.excalidraw',
    bootMode: 'edit',
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    isReady: false,
    key: 'sample-next.excalidraw#file-preview',
    loadedFilePath: null,
    loadedMode: null,
    wrapper: {},
  };

  const needsReload = ExcalidrawEmbedController.prototype._entryNeedsHardReload.call({
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  }, entry);

  assert.equal(needsReload, false);
});

test('hydrate reloads a reused direct-preview iframe when switching files', async () => {
  const calls = [];
  const entry = {
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-next.excalidraw#file-preview',
    label: 'sample-next.excalidraw',
    loadedFilePath: 'sample-prev.excalidraw',
    loadedMode: 'edit',
    placeholder: {
      isConnected: true,
      replaceWith() {},
    },
    wrapper: {
      style: {},
    },
  };

  const controller = {
    followedPeerIdsByFilePath: new Map(),
    _attachWrapper: () => {
      calls.push('attach');
    },
    _entryNeedsHardReload: ExcalidrawEmbedController.prototype._entryNeedsHardReload,
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
    _reloadEntry: (targetEntry) => {
      calls.push(['reload', targetEntry.filePath]);
    },
    _updateEmbedLabel: () => {
      calls.push('label');
    },
  };

  await ExcalidrawEmbedController.prototype._hydrateEntry.call(controller, entry);

  assert.deepEqual(calls, [
    'label',
    ['reload', 'sample-next.excalidraw'],
    'attach',
  ]);
});

test('parking a warm entry clears readiness and disconnects the parked room', () => {
  const originalWindow = globalThis.window;
  const entry = {
    bootFilePath: 'sample-next.excalidraw',
    bootMode: 'edit',
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    isReady: true,
    loadedFilePath: 'sample-next.excalidraw',
    loadedMode: 'edit',
    placeholder: { isConnected: true },
    wrapper: {
      parentElement: null,
      classList: { toggle() {} },
      dataset: {},
      remove() {},
      setAttribute() {},
    },
  };
  const messages = [];
  const warmCacheRoot = {
    appendChild(node) {
      node.parentElement = warmCacheRoot;
    },
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      _ensureWarmCacheRoot: () => warmCacheRoot,
      _exitMaximizedEmbed: () => {},
      _postMessageToEntry: (_entry, payload) => {
        messages.push(payload);
      },
      _setEntryLoadingState: () => {},
    };

    ExcalidrawEmbedController.prototype._parkWarmEntry.call(controller, entry);

    assert.equal(entry.isParked, true);
    assert.equal(entry.isReady, false);
    assert.equal(entry.bootFilePath, null);
    assert.equal(entry.bootMode, null);
    assert.equal(entry.loadedFilePath, null);
    assert.equal(entry.loadedMode, null);
    assert.deepEqual(messages, [{
      source: 'collabmd-host',
      type: 'park-room',
    }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('ignores ready messages from parked iframes', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  const entry = {
    bootFilePath: null,
    bootMode: null,
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: iframeWindow },
    isParked: true,
    isReady: false,
    key: 'sample-next.excalidraw#file-preview',
    wrapper: {},
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const posts = [];
    const controller = {
      embedEntries: new Map([[entry.key, entry]]),
      getTheme: () => 'dark',
      _clearEntryBootTimeout: () => {},
      _entryNeedsHardReload: () => false,
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      _postMessageToEntry: (_entry, payload) => {
        posts.push(payload);
      },
      _setEntryLoadingState: () => {},
      _syncEntryFollowState: () => {},
      _syncEntryUser: () => {},
    };

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'ready',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.equal(entry.isReady, false);
    assert.deepEqual(posts, []);
  } finally {
    globalThis.window = originalWindow;
  }
});
