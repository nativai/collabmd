import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceChromeController } from '../../src/client/application/workspace-chrome-controller.js';

function createController(overrides = {}) {
  return new WorkspaceChromeController({
    beginDocumentLoad() {},
    getDisplayName(filePath) {
      return filePath;
    },
    loadBacklinks() {},
    onBeforeFileOpen() {},
    onFileOpenError() {},
    onFileOpenReady() {},
    onSyncWrapToggle() {},
    onUpdateActiveFile() {},
    onUpdateCurrentFile() {},
    onUpdateLobbyCurrentFile() {},
    onUpdateVisibleChrome() {},
    onViewModeReset() {},
    renderPresence() {},
    showEditorLoading() {},
    stateStore: {
      set() {},
    },
    ...overrides,
  });
}

test('WorkspaceChromeController tolerates missing base preview handlers', () => {
  const controller = createController();

  assert.doesNotThrow(() => {
    controller.finalizeFileOpen({
      filePath: 'views/tasks.base',
      isBase: true,
      supportsBacklinks: false,
    });
  });
});

test('WorkspaceChromeController renders standalone base previews when the handler exists', () => {
  const events = [];
  const controller = createController({
    onRenderBasePreview(filePath) {
      events.push(['render-base', filePath]);
    },
  });

  controller.finalizeFileOpen({
    filePath: 'views/tasks.base',
    isBase: true,
    supportsBacklinks: false,
  });

  assert.deepEqual(events, [['render-base', 'views/tasks.base']]);
});

test('WorkspaceChromeController loads backlinks for direct-preview files without an editor session', () => {
  const events = [];
  const controller = createController({
    loadBacklinks(filePath) {
      events.push(['load-backlinks', filePath]);
    },
    onRenderExcalidrawPreview(filePath) {
      events.push(['render-excalidraw', filePath]);
    },
  });

  controller.finalizeFileOpen({
    filePath: 'diagrams/sketch.excalidraw',
    isExcalidraw: true,
    session: null,
    supportsBacklinks: true,
  });

  assert.deepEqual(events, [
    ['render-excalidraw', 'diagrams/sketch.excalidraw'],
    ['load-backlinks', 'diagrams/sketch.excalidraw'],
  ]);
});
