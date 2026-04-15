import test from 'node:test';
import assert from 'node:assert/strict';

import { DrawioEmbedController } from '../../src/client/presentation/drawio-embed-controller.js';

test('forwards draw.io quick switcher requests from known same-origin iframe', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['diagram.drawio#0', {
        filePath: 'diagram.drawio',
        iframe: { contentWindow: iframeWindow },
        instanceId: 'drawio-1',
      }]]),
      _findEntryByInstanceId: DrawioEmbedController.prototype._findEntryByInstanceId,
      _isMessageFromEntry: DrawioEmbedController.prototype._isMessageFromEntry,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    DrawioEmbedController.prototype._onMessage.call(controller, {
      data: {
        instanceId: 'drawio-1',
        source: 'drawio-editor',
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

test('ignores draw.io quick switcher requests from other origins', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['diagram.drawio#0', {
        filePath: 'diagram.drawio',
        iframe: { contentWindow: iframeWindow },
        instanceId: 'drawio-1',
      }]]),
      _findEntryByInstanceId: DrawioEmbedController.prototype._findEntryByInstanceId,
      _isMessageFromEntry: DrawioEmbedController.prototype._isMessageFromEntry,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    DrawioEmbedController.prototype._onMessage.call(controller, {
      data: {
        instanceId: 'drawio-1',
        source: 'drawio-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'https://example.com',
      source: iframeWindow,
    });

    assert.equal(toggleCalls, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('ignores draw.io quick switcher requests from same-origin non-entry senders', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  const otherWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['diagram.drawio#0', {
        filePath: 'diagram.drawio',
        iframe: { contentWindow: iframeWindow },
        instanceId: 'drawio-1',
      }]]),
      _findEntryByInstanceId: DrawioEmbedController.prototype._findEntryByInstanceId,
      _isMessageFromEntry: DrawioEmbedController.prototype._isMessageFromEntry,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    DrawioEmbedController.prototype._onMessage.call(controller, {
      data: {
        instanceId: 'drawio-1',
        source: 'drawio-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'http://localhost:4173',
      source: otherWindow,
    });

    assert.equal(toggleCalls, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});
