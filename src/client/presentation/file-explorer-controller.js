import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { vaultApiClient } from '../domain/vault-api-client.js';
import { FileActionController } from './file-action-controller.js';
import { FileTreeState } from './file-tree-state.js';
import { FileExplorerView } from './file-explorer-view.js';

export class FileExplorerController {
  constructor({ onFileSelect, onFileDelete, toastController, vaultClient = vaultApiClient }) {
    this.onFileSelect = onFileSelect;
    this.onFileDelete = onFileDelete;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.state = new FileTreeState();
    this.view = new FileExplorerView({
      onDirectoryToggle: (pathValue) => {
        this.state.toggleDirectory(pathValue);
        this.renderTree();
      },
      onFileContextMenu: (event, payload) => {
        if (payload.type === 'directory') {
          this.view.showContextMenu(event, this.actionController.createContextMenuItems(payload.directoryPath));
          return;
        }

        this.view.showContextMenu(event, this.actionController.getFileContextMenuItems(payload.filePath));
      },
      onFileSelect: (filePath) => {
        this.onFileSelect?.(filePath);
      },
      onSearchChange: (value) => {
        this.state.setSearchQuery(value);
        this.renderTree();
      },
      onTreeContextMenu: (event) => {
        this.view.showContextMenu(event, this.actionController.createContextMenuItems());
      },
    });
    this.actionController = new FileActionController({
      onFileDelete: this.onFileDelete,
      onFileSelect: this.onFileSelect,
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
  }

  async refresh() {
    try {
      const data = await this.vaultClient.readTree();
      this.state.setTree(data.tree || []);
      this.renderTree();
    } catch (error) {
      console.error('[explorer] Failed to load file tree:', error.message);
    }
  }

  setActiveFile(filePath) {
    this.state.setActiveFile(filePath);
    this.renderTree();
  }

  get flatFiles() {
    return this.state.flatFiles;
  }

  get flatDocumentFiles() {
    return this.state.flatFiles.filter((path) => !isImageAttachmentFilePath(path));
  }

  renderTree() {
    this.view.render({
      activeFilePath: this.state.activeFilePath,
      expandedDirs: this.state.expandedDirs,
      searchMatches: this.state.getSearchMatches(),
      searchQuery: this.state.searchQuery,
      tree: this.state.tree,
    });
  }
}
