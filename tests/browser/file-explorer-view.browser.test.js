import { afterEach, describe, expect, it, vi } from 'vitest';

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
