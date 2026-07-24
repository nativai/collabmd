import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { vaultApiClient } from '../domain/vault-api-client.js';
import { FileActionController } from './file-action-controller.js';
import { FileTreeState } from './file-tree-state.js';
import { FileExplorerView } from './file-explorer-view.js';

// Coalesce fast typing so an intermediate keystroke (each of which can match a huge
// slice of the wisdom corpus) does not trigger a render. Aligned with the quick-switcher's
// DEFAULT_SEARCH_DEBOUNCE_MS for consistency.
const SEARCH_INPUT_DEBOUNCE_MS = 220;

export class FileExplorerController {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onFileSelect,
    onFileDelete,
    onSubscriptionChange = null,
    pendingWorkspaceRequestIds = null,
    toastController,
    vaultClient = vaultApiClient,
  }) {
    this.onFileSelect = onFileSelect;
    this.onFileDelete = onFileDelete;
    // Notified with the tree's "paths of interest" (expanded directories + the active
    // file) so the server can lazily watch exactly what the user is looking at.
    this.onSubscriptionChange = onSubscriptionChange;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.state = new FileTreeState();
    this.threadCounts = new Map();
    this.searchDebounceTimer = 0;
    this.view = new FileExplorerView({
      mobileBreakpointQuery,
      onDirectorySelect: (pathValue) => {
        this.cancelSearchDebounce();
        this.state.expandDirectoryPath(pathValue);
        this.state.setSearchQuery('');
        this.renderTree({ reset: true });
      },
      onDirectoryToggle: (pathValue) => {
        this.state.toggleDirectory(pathValue);
        this.renderTree();
      },
      onEntryDrop: (payload) => this.actionController.moveEntryByDrop(payload),
      onFileContextMenu: (event, payload) => {
        if (payload.type === 'directory') {
          this.view.showContextMenu(event, this.actionController.getDirectoryContextMenuItems(payload.directoryPath));
          return;
        }

        this.view.showContextMenu(event, this.actionController.getFileContextMenuItems(payload.filePath));
      },
      onFileSelect: (filePath) => {
        this.onFileSelect?.(filePath);
      },
      onValidateDrop: (payload) => this.actionController.canMoveEntryByDrop(payload),
      onSearchChange: (value) => {
        this.scheduleSearch(value);
      },
      onTreeContextMenu: (event) => {
        this.view.showContextMenu(event, this.actionController.createContextMenuItems());
      },
    });
    this.actionController = new FileActionController({
      mobileBreakpointQuery,
      onFileDelete: this.onFileDelete,
      onFileSelect: this.onFileSelect,
      pendingWorkspaceRequestIds,
      refresh: () => this.refresh(),
      state: this.state,
      toastController: this.toastController,
      vaultClient: this.vaultClient,
      view: this.view,
    });
  }

  initialize() {
    this.view.initialize();
    this.actionController.initialize();
    this.bindTreeControls();
  }

  bindTreeControls() {
    document.getElementById('revealActiveFileBtn')?.addEventListener('click', () => {
      this.revealActiveFile();
    });
    document.getElementById('collapseAllBtn')?.addEventListener('click', () => {
      this.collapseAll();
    });
  }

  collapseAll() {
    this.cancelSearchDebounce();
    this.state.expandedDirs.clear();
    this.state.setSearchQuery('');
    this.renderTree({ reset: true });
  }

  revealActiveFile() {
    const filePath = this.state.activeFilePath;
    if (!filePath) {
      return;
    }

    // setActiveFile re-expands the file's ancestor directories; clearing search returns to the
    // tree view; centering (not scrollIntoView) avoids disturbing the preview iframe (DESIGN §6.1).
    this.revealFile(filePath, { center: true, clearSearch: true });
  }

  scheduleSearch(value) {
    this.cancelSearchDebounce();
    this.searchDebounceTimer = window.setTimeout(() => {
      this.searchDebounceTimer = 0;
      this.state.setSearchQuery(value);
      this.renderTree();
    }, SEARCH_INPUT_DEBOUNCE_MS);
  }

  cancelSearchDebounce() {
    if (this.searchDebounceTimer) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = 0;
    }
  }

  async refresh() {
    try {
      const data = await this.vaultClient.readTree();
      this.setTree(data.tree || []);
    } catch (error) {
      console.error('[explorer] Failed to load file tree:', error.message);
    }
  }

  setTree(tree, {
    changedPaths = null,
    reset = false,
  } = {}) {
    this.state.setTree(tree);
    this.renderTree({ changedPaths, reset });
  }

  setActiveFile(filePath) {
    this.state.setActiveFile(filePath);
    this.renderTree();
  }

  setThreadCounts(threadCounts = new Map()) {
    this.threadCounts = threadCounts instanceof Map
      ? new Map(threadCounts)
      : new Map(Object.entries(threadCounts ?? {}));
    this.renderTree();
  }

  revealFile(filePath, { clearSearch = false, center = false } = {}) {
    if (clearSearch) {
      this.cancelSearchDebounce();
      this.state.setSearchQuery('');
    }

    this.state.setActiveFile(filePath);
    this.renderTree({ reset: clearSearch });
    this.view.revealFile(filePath, { center });
  }

  revealDirectory(dirPath) {
    this.state.setSearchQuery('');
    this.state.expandDirectoryPath(dirPath, { includeLeaf: true });
    this.renderTree({ reset: true });
    this.view.revealDirectory(dirPath);
  }

  get flatFiles() {
    return this.state.flatFiles;
  }

  get flatDocumentFiles() {
    return this.state.flatFiles.filter((path) => !isImageAttachmentFilePath(path));
  }

  renderTree({
    changedPaths = null,
    reset = false,
  } = {}) {
    this.view.render({
      activeFilePath: this.state.activeFilePath,
      changedPaths,
      expandedDirs: this.state.expandedDirs,
      reset,
      searchMatches: this.state.getSearchMatches(),
      searchQuery: this.state.searchQuery,
      threadCounts: this.threadCounts,
      tree: this.state.tree,
    });
    this.publishSubscription();
  }

  // renderTree() is the single choke point every tree mutation (expand/collapse,
  // active-file change, collapse-all, reveal) funnels through, so publishing here
  // captures every change. The sync client dedupes, so no-op re-renders are cheap.
  publishSubscription() {
    this.onSubscriptionChange?.({
      activeFile: this.state.activeFilePath,
      dirs: Array.from(this.state.expandedDirs),
    });
  }
}
