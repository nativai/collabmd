import test from 'node:test';
import assert from 'node:assert/strict';

import { QuickSwitcherController } from '../../src/client/presentation/quick-switcher-controller.js';

function createElementStub() {
  return {
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    innerHTML: '',
    querySelectorAll() {
      return [];
    },
    value: '',
  };
}

function installDocumentStub(t) {
  const elements = new Map([
    ['quickSwitcher', createElementStub()],
    ['quickSwitcherHint', createElementStub()],
    ['quickSwitcherInput', createElementStub()],
    ['quickSwitcherResults', createElementStub()],
  ]);

  const originalDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  return elements;
}

test('QuickSwitcherController keeps a bounded top-12 result set and rebuilds corpus only when files change', (t) => {
  const elements = installDocumentStub(t);
  const firstFileList = Array.from({ length: 20 }, (_, index) => `docs/guide-${String(index).padStart(2, '0')}.md`);
  const secondFileList = [...firstFileList, 'archive/guide-special.md'];
  let currentFiles = firstFileList;

  const controller = new QuickSwitcherController({
    getFileList: () => currentFiles,
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.input.value = 'guide';
  controller.filterFiles();

  assert.equal(controller.fileCorpus.length, 20);
  assert.equal(controller.filteredFiles.length, 12);
  const firstCorpusRef = controller.fileCorpus;

  controller.filterFiles();
  assert.equal(controller.fileCorpus, firstCorpusRef);

  currentFiles = secondFileList;
  controller.filterFiles();

  assert.equal(controller.fileCorpus.length, 21);
  assert.notEqual(controller.fileCorpus, firstCorpusRef);
  assert.equal(controller.filteredFiles.length, 12);

  controller.input.value = 'special';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['archive/guide-special.md']);
});
