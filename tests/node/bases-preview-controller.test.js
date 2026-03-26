import test from 'node:test';
import assert from 'node:assert/strict';

import { BasesPreviewController } from '../../src/client/presentation/bases-preview-controller.js';

function createPlaceholder() {
  return {
    innerHTML: '',
    isConnected: true,
  };
}

function createBaseResult({
  cell,
  label = 'Row',
  totalRows = 1,
  type = 'table',
} = {}) {
  return {
    columns: [{ id: 'note.value', label: 'Value' }],
    groups: [{
      key: 'All',
      label: 'All',
      rows: [{
        cells: {
          'note.value': cell ?? { text: label, type: 'string', value: label },
        },
        path: `notes/${label.toLowerCase()}.md`,
      }],
      summaries: [],
      value: { text: '', type: 'empty', value: null },
    }],
    rows: [],
    summaries: [],
    totalRows,
    view: {
      id: 'view-0',
      name: 'Table',
      supported: true,
      type,
    },
    views: [{
      id: 'view-0',
      name: 'Table',
      supported: true,
      type,
    }],
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createWindowStub() {
  return {
    __COLLABMD_CONFIG__: { basePath: '' },
    location: {
      origin: 'http://localhost:5555',
    },
  };
}

class FakeShellNode {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.querySelectorMap = new Map();
  }

  querySelector(selector) {
    return this.querySelectorMap.get(selector) ?? null;
  }
}

class FakeRenderedPlaceholder {
  constructor() {
    this.isConnected = true;
    this.renderCount = 0;
    this._innerHTML = '';
    this.shell = null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.renderCount += 1;

    const shellKeyMatch = this._innerHTML.match(/data-base-shell-key="([^"]+)"/u);
    if (!shellKeyMatch) {
      return;
    }

    const shell = new FakeShellNode();
    const tabs = new FakeShellNode();
    const meta = new FakeShellNode();
    const summarySlot = new FakeShellNode();
    const content = new FakeShellNode();
    const input = new FakeShellNode();

    input.value = this._innerHTML.match(/class="bases-search-input" type="search" value="([^"]*)"/u)?.[1] ?? '';
    meta.textContent = this._innerHTML.match(/data-base-meta>([^<]*)</u)?.[1] ?? '';

    shell.querySelectorMap.set('[data-base-tabs]', tabs);
    shell.querySelectorMap.set('[data-base-meta]', meta);
    shell.querySelectorMap.set('[data-base-summary-slot]', summarySlot);
    shell.querySelectorMap.set('[data-base-content]', content);
    shell.querySelectorMap.set('.bases-search-input', input);

    this.shell = shell;
    this.shellKey = shellKeyMatch[1];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (!this.shell) {
      return null;
    }

    if (selector === '.bases-shell') {
      return this.shell;
    }

    if (selector === `[data-base-shell-key="${this.shellKey}"]`) {
      return this.shell;
    }

    return null;
  }
}

test('BasesPreviewController ignores stale query responses when newer renders finish later', async () => {
  const first = createDeferred();
  const second = createDeferred();
  const controller = new BasesPreviewController({
    vaultApiClient: {
      queryBase() {
        return [first.promise, second.promise].shift();
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'base-entry',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  const queuedResponses = [first.promise, second.promise];
  controller.vaultApiClient.queryBase = () => queuedResponses.shift();

  const firstRender = controller.renderEntry(entry);
  entry.payload.search = 'newer';
  const secondRender = controller.renderEntry(entry);

  second.resolve({ result: createBaseResult({ label: 'Newest', totalRows: 2 }) });
  await secondRender;
  assert.match(placeholder.innerHTML, /2 results/);
  assert.match(placeholder.innerHTML, /Newest/);

  first.resolve({ result: createBaseResult({ label: 'Older', totalRows: 1 }) });
  await firstRender;

  assert.match(placeholder.innerHTML, /2 results/);
  assert.match(placeholder.innerHTML, /Newest/);
  assert.doesNotMatch(placeholder.innerHTML, /Older/);
});

test('BasesPreviewController renders typed image cells through the attachment endpoint', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = createWindowStub();
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            cell: {
              path: 'notes/images/cover.png',
              text: 'images/cover.png',
              type: 'image',
              value: 'notes/images/cover.png',
            },
          }),
        };
      },
    },
  });
  try {
  const placeholder = createPlaceholder();
  const entry = {
    key: 'image-entry',
    payload: {
      path: 'views/gallery.base',
      search: '',
      source: null,
      sourcePath: 'views/gallery.base',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /bases-inline-image/);
  assert.match(placeholder.innerHTML, /\/api\/attachment\?path=notes%2Fimages%2Fcover\.png/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('BasesPreviewController renders file name cells as open-file buttons', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: {
            columns: [{ id: 'file.name', label: 'Name' }],
            groups: [{
              key: 'All',
              label: 'All',
              rows: [{
                cells: {
                  'file.name': {
                    text: 'alpha.md',
                    type: 'string',
                    value: 'alpha.md',
                  },
                },
                path: 'notes/alpha.md',
              }],
              summaries: [],
              value: { text: '', type: 'empty', value: null },
            }],
            rows: [],
            summaries: [],
            totalRows: 1,
            view: {
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            },
            views: [{
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            }],
          },
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'filename-entry',
    payload: {
      path: 'views/files.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /data-base-open-file="notes\/alpha\.md"/);
  assert.match(placeholder.innerHTML, /bases-link-button/);
  assert.match(placeholder.innerHTML, />alpha\.md</);
});

test('BasesPreviewController renders list link items as open-file buttons', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: {
            columns: [{ id: 'file.links', label: 'Links' }],
            groups: [{
              key: 'All',
              label: 'All',
              rows: [{
                cells: {
                  'file.links': {
                    items: [
                      {
                        path: 'notes/target-a.md',
                        text: 'target-a.md',
                        type: 'link',
                        value: 'target-a.md',
                      },
                      {
                        path: 'notes/target-b.md',
                        text: 'target-b.md',
                        type: 'file',
                        value: 'target-b.md',
                      },
                    ],
                    text: 'target-a.md, target-b.md',
                    type: 'list',
                    value: ['target-a.md', 'target-b.md'],
                  },
                },
                path: 'notes/source.md',
              }],
              summaries: [],
              value: { text: '', type: 'empty', value: null },
            }],
            rows: [],
            summaries: [],
            totalRows: 1,
            view: {
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            },
            views: [{
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            }],
          },
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'list-links-entry',
    payload: {
      path: 'views/links.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /data-base-open-file="notes\/target-a\.md"/);
  assert.match(placeholder.innerHTML, /data-base-open-file="notes\/target-b\.md"/);
  assert.match(placeholder.innerHTML, /bases-value-pill/);
});

test('BasesPreviewController preserves the shell during search rerenders', async () => {
  const responses = [
    { result: createBaseResult({ label: 'Initial', totalRows: 1 }) },
    { result: createBaseResult({ label: 'Filtered', totalRows: 2 }) },
  ];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return responses.shift();
      },
    },
  });
  const placeholder = new FakeRenderedPlaceholder();
  const entry = {
    key: 'search-entry',
    payload: {
      path: 'views/search.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);
  assert.equal(placeholder.renderCount, 2);

  const firstInput = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('.bases-search-input');
  const firstContent = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('[data-base-content]');

  entry.search = 'Filtered';
  entry.payload.search = 'Filtered';
  await controller.renderEntry(entry);

  const secondInput = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('.bases-search-input');
  const secondContent = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('[data-base-content]');
  const meta = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('[data-base-meta]');

  assert.equal(placeholder.renderCount, 2);
  assert.equal(secondInput, firstInput);
  assert.equal(secondInput.value, 'Filtered');
  assert.equal(secondContent, firstContent);
  assert.match(secondContent.innerHTML, /Filtered/);
  assert.equal(meta.textContent, '2 results');
});
