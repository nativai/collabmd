import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileExplorerController } from '../../src/client/presentation/file-explorer-controller.js';
import { FileExplorerView } from '../../src/client/presentation/file-explorer-view.js';

function createView(overrides = {}) {
  document.body.innerHTML = `
    <input id="fileSearchInput">
    <nav id="fileTree"></nav>
  `;

  return new FileExplorerView({
    mobileBreakpointQuery: { matches: true },
    onEntryDrop: vi.fn(),
    onDirectorySelect: vi.fn(),
    onDirectoryToggle: vi.fn(),
    onFileContextMenu: vi.fn(),
    onFileSelect: vi.fn(),
    onSearchChange: vi.fn(),
    onTreeContextMenu: vi.fn(),
    onValidateDrop: vi.fn(() => true),
    ...overrides,
  });
}

describe('FileExplorerView mobile interactions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens file actions after a mobile long press', () => {
    vi.useFakeTimers();
    const onFileContextMenu = vi.fn();
    const view = createView({ onFileContextMenu });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 24,
      clientY: 18,
      pointerId: 1,
      pointerType: 'touch',
    }));

    vi.advanceTimersByTime(421);

    expect(onFileContextMenu).toHaveBeenCalledTimes(1);
    expect(onFileContextMenu.mock.calls[0][1]).toEqual({ filePath: 'README.md', type: 'file' });
  });

  it('renders file-level open comment counts', () => {
    const view = createView();

    view.render({
      activeFilePath: null,
      threadCounts: new Map([['README.md', 2]]),
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    expect(item.classList.contains('has-comments')).toBe(true);
    expect(item.dataset.threadCount).toBe('2');
    expect(item.querySelector('.file-tree-comment-count').textContent).toBe('2');
  });

  it('cancels a long press when the pointer moves like a scroll gesture', () => {
    vi.useFakeTimers();
    const onFileContextMenu = vi.fn();
    const view = createView({ onFileContextMenu });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 24,
      clientY: 18,
      pointerId: 2,
      pointerType: 'touch',
    }));
    item.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: 24,
      clientY: 36,
      pointerId: 2,
      pointerType: 'touch',
    }));

    vi.advanceTimersByTime(421);

    expect(onFileContextMenu).not.toHaveBeenCalled();
  });
});

describe('FileExplorerView drag and drop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('emits a drop payload for directory targets on desktop', () => {
    const onEntryDrop = vi.fn();
    const onValidateDrop = vi.fn(() => true);
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onEntryDrop,
      onValidateDrop,
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(['docs']),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [
        { name: 'README.md', path: 'README.md', type: 'file' },
        {
          children: [],
          name: 'docs',
          path: 'docs',
          type: 'directory',
        },
      ],
    });

    const transfer = new DataTransfer();
    const fileItem = document.querySelector('.file-tree-file');
    const directoryItem = document.querySelector('.file-tree-dir');

    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    directoryItem.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    directoryItem.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));

    expect(onValidateDrop).toHaveBeenCalledWith({
      destinationDirectory: 'docs',
      sourcePath: 'README.md',
      sourceType: 'file',
    });
    expect(onEntryDrop).toHaveBeenCalledWith({
      destinationDirectory: 'docs',
      sourcePath: 'README.md',
      sourceType: 'file',
    });
  });

  it('disables drag interactions while search results are shown', () => {
    const onEntryDrop = vi.fn();
    const onValidateDrop = vi.fn(() => true);
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onEntryDrop,
      onValidateDrop,
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [{ name: 'README.md', path: 'README.md', type: 'file' }],
      searchQuery: 'read',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const fileItem = document.querySelector('.file-tree-file');
    expect(fileItem.draggable).toBe(false);
    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));

    expect(onValidateDrop).not.toHaveBeenCalled();
    expect(onEntryDrop).not.toHaveBeenCalled();
  });

  it('marks invalid directory drop targets with a rejected state', () => {
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onValidateDrop: vi.fn(() => false),
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(['docs']),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [
        { name: 'README.md', path: 'README.md', type: 'file' },
        {
          children: [],
          name: 'docs',
          path: 'docs',
          type: 'directory',
        },
      ],
    });

    const transfer = new DataTransfer();
    const fileItem = document.querySelector('.file-tree-file');
    const directoryItem = document.querySelector('.file-tree-dir');

    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    directoryItem.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));

    expect(directoryItem.classList.contains('is-drop-invalid')).toBe(true);
    expect(directoryItem.classList.contains('is-drop-target')).toBe(false);
  });

  it('treats the empty tree surface as a root drop target', () => {
    const onEntryDrop = vi.fn();
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onEntryDrop,
      onValidateDrop: vi.fn(() => true),
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'notes.md', path: 'notes.md', type: 'file' }],
    });

    const transfer = new DataTransfer();
    const fileItem = document.querySelector('.file-tree-file');
    const tree = document.getElementById('fileTree');
    const rootZone = document.querySelector('.file-tree-root-drop-zone');

    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    expect(tree.dataset.dragActive).toBe('true');
    view.handleRootZoneDragOver({
      dataTransfer: transfer,
      preventDefault() {},
      stopPropagation() {},
      target: rootZone,
    });
    view.handleRootZoneDrop({
      dataTransfer: transfer,
      preventDefault() {},
      stopPropagation() {},
      target: rootZone,
    });

    expect(tree.classList.contains('is-drop-target-root')).toBe(false);
    expect(rootZone.classList.contains('is-drop-target')).toBe(false);
    expect(onEntryDrop).toHaveBeenCalledWith({
      destinationDirectory: '',
      sourcePath: 'notes.md',
      sourceType: 'file',
    });
  });
});

describe('FileExplorerView bounded search rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('caps the rendered search result DOM regardless of match count', () => {
    const view = createView();

    const matches = Array.from({ length: 5000 }, (_, index) => ({
      name: `file${index}.md`,
      path: `dir/file${index}.md`,
      type: 'file',
    }));

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: matches,
      searchQuery: 'file',
      tree: [],
    });

    const rendered = document.querySelectorAll('.file-tree-search-results .file-tree-file');
    expect(rendered).toHaveLength(50);

    // The whole subtree stays far below the 105k nodes the unbounded render built.
    const nodeCount = document.getElementById('fileTree').querySelectorAll('*').length;
    expect(nodeCount).toBeLessThan(1000);

    const summary = document.querySelector('.file-tree-search-summary');
    expect(summary.textContent).toContain('5000 matches');
    expect(summary.textContent).toContain('showing top 50');
  });

  it('shows an exact count when every match fits in the first window', () => {
    const view = createView();

    const matches = Array.from({ length: 8 }, (_, index) => ({
      name: `note${index}.md`,
      path: `dir/note${index}.md`,
      type: 'file',
    }));

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: matches,
      searchQuery: 'note',
      tree: [],
    });

    expect(document.querySelectorAll('.file-tree-search-results .file-tree-file')).toHaveLength(8);
    expect(document.querySelector('.file-tree-search-summary').textContent).toBe('8 matches');
  });

  it('renders the folder breadcrumb via the shared component (display-only) on search result rows', () => {
    const view = createView();

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [
        { name: 'SKILL.md', path: 'Operating System/Skills/operating-system/SKILL.md', type: 'file' },
        { name: 'notes.md', path: 'notes.md', type: 'file' },
      ],
      searchQuery: 'skill',
      tree: [],
    });

    const rows = document.querySelectorAll('.file-tree-search-results .file-tree-file');
    // Reuses the shared canonical breadcrumb component (breadcrumb-view.js) — the nav
    // carries both the shared `.breadcrumb-bar` class and the inline scope class.
    const crumbNav = rows[0].querySelector('nav.breadcrumb-bar.file-tree-breadcrumb');
    expect(crumbNav).not.toBeNull();
    // Display-only: no interactive buttons, no vault-root icon.
    expect(crumbNav.querySelector('button')).toBeNull();
    expect(crumbNav.querySelector('.breadcrumb-crumb--root')).toBeNull();
    // Deep path is folded to first / … / deepest folder, rendered as shared crumbs.
    const crumbLabels = [...crumbNav.querySelectorAll('.breadcrumb-crumb')].map((el) => el.textContent);
    expect(crumbLabels).toEqual(['Operating System', '…', 'operating-system']);
    // A root-level file has no containing folder — no breadcrumb.
    expect(rows[1].querySelector('.file-tree-breadcrumb')).toBeNull();
  });

  it('ranks filename matches ahead of path-only matches', () => {
    const view = createView();

    // "report" hits the folder segment of the first entry (path-only) and the file name of
    // the second entry (name match). The name match must render first.
    const matches = [
      { name: 'summary.md', path: 'reports/summary.md', type: 'file' },
      { name: 'report.md', path: 'docs/report.md', type: 'file' },
    ];

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: matches,
      searchQuery: 'report',
      tree: [],
    });

    const rows = document.querySelectorAll('.file-tree-search-results .file-tree-file');
    expect(rows[0].dataset.path).toBe('docs/report.md');
    expect(rows[1].dataset.path).toBe('reports/summary.md');
  });

  it('appends the next window on demand without rebuilding rendered rows', () => {
    const view = createView();

    const matches = Array.from({ length: 350 }, (_, index) => ({
      name: `file${index}.md`,
      path: `dir/file${index}.md`,
      type: 'file',
    }));

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: matches,
      searchQuery: 'file',
      tree: [],
    });

    expect(document.querySelectorAll('.file-tree-search-results .file-tree-file')).toHaveLength(50);

    view.appendSearchResults(50);
    expect(document.querySelectorAll('.file-tree-search-results .file-tree-file')).toHaveLength(100);
    expect(document.querySelector('.file-tree-search-summary').textContent).toContain('showing top 100');

    view.appendSearchResults(50);
    view.appendSearchResults(50);
    view.appendSearchResults(50);
    view.appendSearchResults(50);
    expect(document.querySelectorAll('.file-tree-search-results .file-tree-file')).toHaveLength(350);
    expect(document.querySelector('.file-tree-search-summary').textContent).toBe('350 matches');
  });
});

describe('FileExplorerController search debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function createController() {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;

    const controller = new FileExplorerController({
      mobileBreakpointQuery: { matches: true },
      onFileDelete: vi.fn(),
      onFileSelect: vi.fn(),
      toastController: { show: vi.fn() },
      vaultClient: { readTree: vi.fn() },
    });

    controller.setTree([
      { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
      { name: 'readme.md', path: 'docs/readme.md', type: 'file' },
    ], { reset: true });

    return controller;
  }

  it('renders search results only after the debounce interval elapses', () => {
    vi.useFakeTimers();
    const controller = createController();

    controller.scheduleSearch('guide');
    expect(document.querySelector('.file-tree-search-summary')).toBeNull();

    vi.advanceTimersByTime(220);

    expect(document.querySelector('.file-tree-search-summary')).not.toBeNull();
    expect(document.querySelectorAll('.file-tree-search-results .file-tree-file')).toHaveLength(1);
    expect(document.querySelector('.file-tree-search-results .file-tree-file').dataset.path)
      .toBe('docs/guide.md');
  });

  it('coalesces rapid keystrokes into a single render of the latest query', () => {
    vi.useFakeTimers();
    const controller = createController();
    const renderSpy = vi.spyOn(controller, 'renderTree');

    controller.scheduleSearch('g');
    vi.advanceTimersByTime(100);
    controller.scheduleSearch('guide');
    vi.advanceTimersByTime(100);

    // The first keystroke's timer was cancelled — nothing rendered yet.
    expect(renderSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.file-tree-search-summary')).toBeNull();

    vi.advanceTimersByTime(120);

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(controller.state.searchQuery).toBe('guide');
  });
});

describe('FileExplorerController tree controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function createController() {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;
    const controller = new FileExplorerController({
      mobileBreakpointQuery: { matches: false },
      onFileDelete: vi.fn(),
      onFileSelect: vi.fn(),
      toastController: { show: vi.fn() },
      vaultClient: { readTree: vi.fn() },
    });
    controller.setTree([{
      children: [{
        children: [
          { name: 'guide.md', path: 'docs/guides/guide.md', type: 'file' },
        ],
        name: 'guides',
        path: 'docs/guides',
        type: 'directory',
      }],
      name: 'docs',
      path: 'docs',
      type: 'directory',
    }], { reset: true });
    return controller;
  }

  it('collapses every expanded folder back to the top level', () => {
    const controller = createController();
    controller.state.expandDirectoryPath('docs/guides');
    controller.renderTree({ reset: true });
    expect(document.querySelectorAll('.file-tree-children').length).toBeGreaterThan(0);

    controller.collapseAll();

    expect(controller.state.expandedDirs.size).toBe(0);
    expect(document.querySelectorAll('.file-tree-children')).toHaveLength(0);
    expect(document.querySelectorAll('.file-tree-dir')).toHaveLength(1); // only top-level 'docs'
  });

  it('reveal-active re-expands the active file ancestors after a collapse', () => {
    const controller = createController();
    controller.setActiveFile('docs/guides/guide.md');
    controller.collapseAll();
    expect(controller.state.expandedDirs.size).toBe(0);

    controller.revealActiveFile();

    expect([...controller.state.expandedDirs].sort()).toEqual(['docs', 'docs/guides']);
    expect(document.querySelector('.file-tree-file.active')?.dataset.path).toBe('docs/guides/guide.md');
  });
});

describe('File explorer reveal behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('scrolls the matching file into view when revealed', () => {
    const view = createView();

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(['docs']),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{
        children: [
          { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
        ],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      }],
    });

    const item = document.querySelector('[data-path="docs/guide.md"]');
    item.scrollIntoView = vi.fn();

    view.revealFile('docs/guide.md');

    expect(item.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('clears tree search before revealing a quick-switcher file', () => {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const controller = new FileExplorerController({
        mobileBreakpointQuery: { matches: true },
        onFileDelete: vi.fn(),
        onFileSelect: vi.fn(),
        toastController: { show: vi.fn() },
        vaultClient: { readTree: vi.fn() },
      });

      controller.setTree([{
        children: [{
          children: [
            { name: 'guide.md', path: 'docs/guides/guide.md', type: 'file' },
          ],
          name: 'guides',
          path: 'docs/guides',
          type: 'directory',
        }],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      }], { reset: true });

      controller.state.setSearchQuery('guide');
      controller.renderTree();
      expect(document.querySelectorAll('.file-tree-children')).toHaveLength(0);

      controller.revealFile('docs/guides/guide.md', { clearSearch: true });

      expect(document.getElementById('fileSearchInput').value).toBe('');
      expect(document.querySelectorAll('.file-tree-dir')).toHaveLength(2);
      expect(document.querySelector('.file-tree-file.active')?.dataset.path).toBe('docs/guides/guide.md');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('does not auto-scroll for normal active-file updates', () => {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const controller = new FileExplorerController({
        mobileBreakpointQuery: { matches: true },
        onFileDelete: vi.fn(),
        onFileSelect: vi.fn(),
        toastController: { show: vi.fn() },
        vaultClient: { readTree: vi.fn() },
      });

      controller.setTree([{
        children: [
          { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
        ],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      }], { reset: true });

      controller.setActiveFile('docs/guide.md');

      expect(document.querySelector('.file-tree-file.active')?.dataset.path).toBe('docs/guide.md');
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
