import test from 'node:test';
import assert from 'node:assert/strict';

import { BasesPreviewController } from '../../src/client/presentation/bases-preview-controller.js';

function createPlaceholder() {
  const classes = new Set(['bases-embed-placeholder', 'diagram-preview-shell']);
  return {
    classList: {
      add(...tokens) {
        tokens.forEach((token) => classes.add(token));
      },
      contains(token) {
        return classes.has(token);
      },
      remove(...tokens) {
        tokens.forEach((token) => classes.delete(token));
      },
    },
    innerHTML: '',
    isConnected: true,
  };
}

function createBaseResult({
  cell,
  columns = [{ id: 'note.value', label: 'Value' }],
  label = 'Row',
  meta = null,
  totalRows = 1,
  type = 'table',
} = {}) {
  return {
    columns,
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
    meta: meta ?? {
      activeViewConfig: {
        filters: null,
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
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

class FakeInputNode {
  constructor() {
    this.selectionEnd = 0;
    this.selectionStart = 0;
    this.value = '';
    this.focused = false;
  }

  focus() {
    this.focused = true;
    if (globalThis.document) {
      globalThis.document.activeElement = this;
    }
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakePanelSlotNode {
  constructor() {
    this._innerHTML = '';
    this.propertiesList = null;
    this.propertiesSearch = null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this._innerHTML.includes('data-base-properties-list')) {
      this.propertiesList = { scrollTop: 0 };
      const search = new FakeInputNode();
      search.value = this._innerHTML.match(/data-base-properties-search[^>]*value="([^"]*)"/u)?.[1] ?? '';
      search.selectionStart = search.value.length;
      search.selectionEnd = search.value.length;
      this.propertiesSearch = search;
    } else {
      this.propertiesList = null;
      this.propertiesSearch = null;
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (selector === '[data-base-properties-list]') {
      return this.propertiesList;
    }
    if (selector === '[data-base-properties-search]') {
      return this.propertiesSearch;
    }
    return null;
  }
}

class FakeRenderedPlaceholder {
  constructor() {
    const classes = new Set(['bases-embed-placeholder', 'diagram-preview-shell']);
    this.classList = {
      add: (...tokens) => {
        tokens.forEach((token) => classes.add(token));
      },
      contains: (token) => classes.has(token),
      remove: (...tokens) => {
        tokens.forEach((token) => classes.delete(token));
      },
    };
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
    const panelSlot = new FakePanelSlotNode();
    const summarySlot = new FakeShellNode();
    const content = new FakeShellNode();
    const input = new FakeShellNode();

    input.value = this._innerHTML.match(/class="bases-search-input" type="search" value="([^"]*)"/u)?.[1] ?? '';
    meta.textContent = this._innerHTML.match(/data-base-meta>([^<]*)</u)?.[1] ?? '';
    panelSlot.innerHTML = this._innerHTML.match(/<div class="bases-panels" data-base-panel-slot>([\s\S]*?)<\/div>\s*<div data-base-summary-slot>/u)?.[1] ?? '';

    shell.querySelectorMap.set('[data-base-tabs]', tabs);
    shell.querySelectorMap.set('[data-base-meta]', meta);
    shell.querySelectorMap.set('[data-base-panel-slot]', panelSlot);
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

test('BasesPreviewController removes the placeholder shell chrome after hydration', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({ label: 'Hydrated', totalRows: 2 }),
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'hydrated-entry',
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

  await controller.renderEntry(entry);

  assert.equal(placeholder.classList.contains('diagram-preview-shell'), false);
  assert.equal(placeholder.classList.contains('is-hydrated'), true);
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

test('BasesPreviewController applies transformed standalone base source through the session callback', async () => {
  const transformed = {
    result: createBaseResult({ label: 'Updated', totalRows: 2 }),
    source: 'views:\n  - type: table\n',
  };
  const calls = [];
  const controller = new BasesPreviewController({
    replaceBaseSource(payload) {
      calls.push(['replace', payload.path, payload.source]);
    },
    vaultApiClient: {
      async transformBase() {
        return { result: transformed };
      },
    },
  });
  const entry = {
    key: 'standalone',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    requestVersion: 0,
    result: createBaseResult({ label: 'Before' }),
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: '',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.updateViewConfig(entry, (config) => config);

  assert.deepEqual(calls, [['replace', 'views/tasks.base', 'views:\n  - type: table\n']]);
  assert.equal(entry.payload.source, 'views:\n  - type: table\n');
  assert.equal(entry.result.totalRows, 2);
});

test('BasesPreviewController renders inline base editing controls as read-only', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: null,
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: false,
            },
          }),
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'inline-entry',
    payload: {
      path: '',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'notes/source.md',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'sort',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /Inline base previews are read-only/);
  assert.match(placeholder.innerHTML, /data-base-panel="sort" disabled/);
});

test('BasesPreviewController marks implicitly visible properties as checked in the properties panel', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            columns: [
              { id: 'file.name', label: 'Name' },
              { id: 'note.value', label: 'Value' },
            ],
            meta: {
              activeViewConfig: {
                filters: null,
                groupBy: null,
                order: [],
                sort: [],
              },
              availableProperties: [
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'file.name',
                  kind: 'file',
                  label: 'Name',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.extra',
                  kind: 'note',
                  label: 'Extra',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: false,
                },
              ],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'properties-entry',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder: createPlaceholder(),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'properties',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);

  assert.match(entry.placeholder.innerHTML, /data-base-property-toggle="file\.name" checked/);
  assert.match(entry.placeholder.innerHTML, /data-base-property-toggle="note\.value" checked/);
  assert.doesNotMatch(entry.placeholder.innerHTML, /data-base-property-toggle="note\.extra" checked/);
});

test('BasesPreviewController preserves implicit columns when enabling a new property', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: createBaseResult({
            columns: [
              { id: 'file.name', label: 'Name' },
              { id: 'note.value', label: 'Value' },
              { id: 'note.extra', label: 'Extra' },
            ],
            meta: {
              activeViewConfig: payload.mutation.config,
              availableProperties: [
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'file.name',
                  kind: 'file',
                  label: 'Name',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.extra',
                  kind: 'note',
                  label: 'Extra',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
              ],
              editable: true,
            },
          }),
        };
      },
      async writeFile() {},
    },
  });
  const entry = {
    key: 'implicit-toggle',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      columns: [
        { id: 'file.name', label: 'Name' },
        { id: 'note.value', label: 'Value' },
      ],
      meta: {
        activeViewConfig: {
          filters: null,
          groupBy: null,
          order: [],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'file.name',
            kind: 'file',
            label: 'Name',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.value',
            kind: 'note',
            label: 'Value',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.extra',
            kind: 'note',
            label: 'Extra',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: false,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'properties',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const propertyToggle = {
    checked: true,
    dataset: { basePropertyToggle: 'note.extra' },
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-property-toggle]':
            return propertyToggle;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls[0].mutation.config.order, [
    'file.name',
    'note.value',
    'note.extra',
  ]);
});

test('BasesPreviewController preserves properties search focus while typing', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const controller = new BasesPreviewController({
      vaultApiClient: {
        async queryBase() {
          return {
            result: createBaseResult({
              columns: [
                { id: 'file.name', label: 'Name' },
                { id: 'note.value', label: 'Value' },
              ],
              meta: {
                activeViewConfig: {
                  filters: null,
                  groupBy: null,
                  order: ['file.name', 'note.value'],
                  sort: [],
                },
                availableProperties: [
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'file.name',
                    kind: 'file',
                    label: 'Name',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'note.value',
                    kind: 'note',
                    label: 'Value',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
          };
        },
      },
    });
    const placeholder = new FakeRenderedPlaceholder();
    const entry = {
      key: 'properties-search-focus',
      payload: {
        path: 'views/tasks.base',
        search: '',
        source: null,
        sourcePath: '',
        view: '',
      },
      placeholder,
      propertyValueOptions: new Map(),
      requestVersion: 0,
      result: null,
      search: '',
      ui: {
        builderFilter: null,
        filterMode: 'builder',
        openPanel: 'properties',
        propertySearch: '',
        rawFilterText: '',
      },
    };
    controller.entries.set(entry.key, entry);

    await controller.renderEntry(entry);

    const panelSlot = placeholder.querySelector('[data-base-shell-key="properties-search-focus"]').querySelector('[data-base-panel-slot]');
    const searchInput = panelSlot.querySelector('[data-base-properties-search]');
    searchInput.value = 'n';
    searchInput.selectionStart = 1;
    searchInput.selectionEnd = 1;
    searchInput.focus();

    const shell = {
      dataset: { baseShellKey: entry.key },
      closest(selector) {
        return selector === '[data-base-shell-key]' ? this : null;
      },
    };
    searchInput.closest = (selector) => (selector === '[data-base-shell-key]' ? shell : null);

    controller.handleInput({
      target: {
        closest(selector) {
          switch (selector) {
            case '.bases-search-input':
              return null;
            case '[data-base-properties-search]':
              return searchInput;
            default:
              return null;
          }
        },
      },
    });

    const nextSearchInput = panelSlot.querySelector('[data-base-properties-search]');
    assert.equal(entry.ui.propertySearch, 'n');
    assert.equal(globalThis.document.activeElement, nextSearchInput);
    assert.equal(nextSearchInput.selectionStart, 1);
    assert.equal(nextSearchInput.selectionEnd, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('BasesPreviewController preserves properties-list scroll position when toggling a property', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            columns: [
              { id: 'file.name', label: 'Name' },
              { id: 'note.value', label: 'Value' },
            ],
            meta: {
              activeViewConfig: {
                filters: null,
                groupBy: null,
                order: ['file.name', 'note.value'],
                sort: [],
              },
              availableProperties: [
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'file.name',
                  kind: 'file',
                  label: 'Name',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.extra',
                  kind: 'note',
                  label: 'Extra',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: false,
                },
              ],
              editable: true,
            },
          }),
        };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              columns: [
                { id: 'file.name', label: 'Name' },
                { id: 'note.value', label: 'Value' },
                { id: 'note.extra', label: 'Extra' },
              ],
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'file.name',
                    kind: 'file',
                    label: 'Name',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'note.value',
                    kind: 'note',
                    label: 'Value',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'note.extra',
                    kind: 'note',
                    label: 'Extra',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
      async writeFile() {},
    },
  });
  const placeholder = new FakeRenderedPlaceholder();
  const entry = {
    key: 'properties-scroll',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder,
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      columns: [
        { id: 'file.name', label: 'Name' },
        { id: 'note.value', label: 'Value' },
      ],
      meta: {
        activeViewConfig: {
          filters: null,
          groupBy: null,
          order: ['file.name', 'note.value'],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'file.name',
            kind: 'file',
            label: 'Name',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.value',
            kind: 'note',
            label: 'Value',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.extra',
            kind: 'note',
            label: 'Extra',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: false,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'properties',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  await controller.renderEntry(entry);
  const panelSlot = placeholder.querySelector('[data-base-shell-key="properties-scroll"]').querySelector('[data-base-panel-slot]');
  const propertiesList = panelSlot.querySelector('[data-base-properties-list]');
  propertiesList.scrollTop = 240;

  const shell = { dataset: { baseShellKey: entry.key } };
  const propertyToggle = {
    checked: true,
    dataset: { basePropertyToggle: 'note.extra' },
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-property-toggle]':
            return propertyToggle;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(transformCalls[0].mutation.config.order.includes('note.extra'), true);
  assert.equal(panelSlot.querySelector('[data-base-properties-list]').scrollTop, 240);
});

test('BasesPreviewController preserves empty filter group conjunction selections in the builder UI', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'empty-filter-conjunction',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult(),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterConjunction = {
    dataset: { baseFilterConjunction: '' },
    value: 'or',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-conjunction]':
            return filterConjunction;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(transformCalls[0].mutation.config.filters, null);
  assert.match(entry.placeholder.innerHTML, /<option value="or" selected>Any of the following are true<\/option>/);
});

test('BasesPreviewController serializes not filter groups as arrays', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'not-filter-array',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      meta: {
        activeViewConfig: {
          filters: {
            not: [
              'note.value == "before"',
            ],
          },
          groupBy: null,
          order: ['note.value'],
          sort: [],
        },
        availableProperties: [{
          filterOperators: ['is', 'is not'],
          groupable: true,
          id: 'note.value',
          kind: 'note',
          label: 'Value',
          sortable: true,
          sortDirections: [{ id: 'asc', label: 'A → Z' }],
          valueType: 'text',
          visible: true,
        }],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterConjunction = {
    dataset: { baseFilterConjunction: '' },
    value: 'not',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-conjunction]':
            return filterConjunction;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    not: ['note.value == "before"'],
  });
});

test('BasesPreviewController parses nested not filter objects into builder state', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: {
                  not: {
                    or: [
                      'note.value == "before"',
                    ],
                  },
                },
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'parse-nested-not-filter',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder: createPlaceholder(),
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.deepEqual(entry.ui.builderFilter, {
    children: [{
      operator: 'is',
      propertyId: 'note.value',
      type: 'rule',
      value: 'before',
    }],
    conjunction: 'not',
    type: 'group',
  });
});

test('BasesPreviewController does not render stale property suggestions after filters change', async () => {
  const placeholder = createPlaceholder();
  const initialResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == "before"',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
  });
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: initialResult.meta.availableProperties,
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'stale-values',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder,
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: 'old-cache-key',
        values: [{ count: 1, text: 'stale', value: 'stale' }],
      }],
    ]),
    requestVersion: 0,
    result: initialResult,
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.updateViewConfig(entry, (config) => ({
    ...config,
    filters: 'note.value == "after"',
  }));

  assert.doesNotMatch(placeholder.innerHTML, /<option value="stale">/);
});
