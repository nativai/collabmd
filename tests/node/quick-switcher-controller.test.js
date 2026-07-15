import test from 'node:test';
import assert from 'node:assert/strict';

import { QuickSwitcherController } from '../../src/client/presentation/quick-switcher-controller.js';

function createElementStub({ dataset = {} } = {}) {
  const listeners = new Map();

  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    dataset,
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
    innerHTML: '',
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
    textContent: '',
    value: '',
  };
}

function installDocumentStub(t, { modeTabs = [] } = {}) {
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
    querySelectorAll(selector) {
      if (selector === '[data-qs-mode]') {
        return modeTabs;
      }

      return [];
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

test('QuickSwitcherController falls back to name search when ripgrep is unavailable', (t) => {
  const elements = installDocumentStub(t);

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: false, minQueryLength: 2 }),
    onFileSelect() {},
    searchText: async () => {
      throw new Error('should not search without ripgrep');
    },
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.hint = elements.get('quickSwitcherHint');
  controller.resultsList = elements.get('quickSwitcherResults');

  controller.input.value = 'needle';
  controller.setMode('text', { preserveInput: true });

  // UX6: a content-search query with no ripgrep must not dead-end — it falls over to Files mode
  // with the same query and tells the user, rather than showing a bare error.
  assert.equal(controller.mode, 'files');
  assert.equal(controller.contentFallbackActive, true);
  assert.match(controller.hint.textContent, /searching names instead/i);
});

test('QuickSwitcherController preserves the query when switching search modes', (t) => {
  const textTab = createElementStub({ dataset: { qsMode: 'text' } });
  const elements = installDocumentStub(t, { modeTabs: [textTab] });

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
    onFileSelect() {},
    searchText: async () => ({ files: [] }),
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.input.value = 'needle';

  textTab.dispatchEvent({ type: 'click' });

  assert.equal(controller.mode, 'text');
  assert.equal(controller.input.value, 'needle');
});

test('QuickSwitcherController ignores text search results after close', async (t) => {
  const elements = installDocumentStub(t);
  let resolveSearch;
  let markSearchStarted;
  const searchStarted = new Promise((resolve) => {
    markSearchStarted = resolve;
  });
  const searchResult = new Promise((resolve) => {
    resolveSearch = resolve;
  });
  let rendered = false;

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
    onFileSelect() {},
    searchDebounceMs: 0,
    searchText: async () => {
      markSearchStarted();
      return searchResult;
    },
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.hint = elements.get('quickSwitcherHint');
  controller.overlay = elements.get('quickSwitcher');
  controller.resultsList = elements.get('quickSwitcherResults');
  controller.renderTextResults = () => {
    rendered = true;
  };

  controller.isOpen = true;
  controller.input.value = 'needle';
  controller.setMode('text', { preserveInput: true });
  await searchStarted;

  controller.close();
  resolveSearch({
    files: [{
      file: 'README.md',
      kind: 'markdown',
      matchCount: 1,
      snippets: [{
        column: 1,
        line: 1,
        matchEnd: 6,
        matchStart: 0,
        text: 'needle',
      }],
    }],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(rendered, false);
});

test('QuickSwitcherController confirms text search matches with navigation payload', async (t) => {
  const elements = installDocumentStub(t);
  let selectedMatch = null;

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
    onFileSelect() {},
    onTextMatchSelect(match) {
      selectedMatch = match;
    },
    searchDebounceMs: 0,
    searchText: async () => ({
      files: [{
        file: 'diagram.drawio',
        kind: 'drawio',
        matchCount: 1,
        snippets: [{
          column: 4,
          line: 7,
          matchEnd: 9,
          matchStart: 3,
          text: 'abcneedle',
        }],
      }],
    }),
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.hint = elements.get('quickSwitcherHint');
  controller.overlay = elements.get('quickSwitcher');
  controller.resultsList = elements.get('quickSwitcherResults');

  controller.isOpen = true;
  controller.input.value = 'needle';
  controller.setMode('text', { preserveInput: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  controller.confirmSelection();

  assert.deepEqual(selectedMatch, {
    column: 4,
    file: 'diagram.drawio',
    kind: 'drawio',
    line: 7,
    matchLength: 6,
    snippet: {
      column: 4,
      line: 7,
      matchEnd: 9,
      matchStart: 3,
      text: 'abcneedle',
    },
  });
});
