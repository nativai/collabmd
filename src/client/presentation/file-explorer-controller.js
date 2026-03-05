export class FileExplorerController {
  constructor({ onFileSelect, onFileCreate, onFileDelete, onFileRename }) {
    this.onFileSelect = onFileSelect;
    this.onFileCreate = onFileCreate;
    this.onFileDelete = onFileDelete;
    this.onFileRename = onFileRename;
    this.panel = document.getElementById('fileExplorer');
    this.treeContainer = document.getElementById('fileTree');
    this.newFileButton = document.getElementById('newFileBtn');
    this.newFolderButton = document.getElementById('newFolderBtn');
    this.refreshButton = document.getElementById('refreshFilesBtn');
    this.searchInput = document.getElementById('fileSearchInput');
    this.tree = [];
    this.flatFiles = [];
    this.activeFilePath = null;
    this.expandedDirs = new Set();
    this.searchQuery = '';
  }

  initialize() {
    this.newFileButton?.addEventListener('click', () => this.handleNewFile());
    this.newFolderButton?.addEventListener('click', () => this.handleNewFolder());
    this.refreshButton?.addEventListener('click', () => this.refresh());
    this.searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderTree();
    });
  }

  async refresh() {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      this.tree = data.tree || [];
      this.flatFiles = this.flattenTree(this.tree);
      this.renderTree();
    } catch (error) {
      console.error('[explorer] Failed to load file tree:', error.message);
    }
  }

  flattenTree(nodes, prefix = '') {
    const files = [];
    for (const node of nodes) {
      if (node.type === 'file') {
        files.push(node.path);
      } else if (node.type === 'directory' && node.children) {
        files.push(...this.flattenTree(node.children, node.path));
      }
    }
    return files;
  }

  setActiveFile(filePath) {
    this.activeFilePath = filePath;

    if (filePath) {
      const parts = filePath.split('/');
      let dirPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
        this.expandedDirs.add(dirPath);
      }
    }

    this.renderTree();
  }

  renderTree() {
    if (!this.treeContainer) return;

    if (this.searchQuery) {
      this.renderSearchResults();
      return;
    }

    this.treeContainer.innerHTML = '';

    if (this.tree.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No markdown files found</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    this.renderNodes(this.tree, fragment, 0);
    this.treeContainer.appendChild(fragment);
  }

  renderSearchResults() {
    if (!this.treeContainer) return;
    this.treeContainer.innerHTML = '';

    const matches = this.flatFiles.filter((path) =>
      path.toLowerCase().includes(this.searchQuery),
    );

    if (matches.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No matches</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const filePath of matches) {
      const item = this.createFileItem(filePath.split('/').pop(), filePath, 0);
      fragment.appendChild(item);
    }
    this.treeContainer.appendChild(fragment);
  }

  renderNodes(nodes, container, depth) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        const dir = this.createDirectoryItem(node, depth);
        container.appendChild(dir);
      } else {
        const file = this.createFileItem(node.name, node.path, depth);
        container.appendChild(file);
      }
    }
  }

  createDirectoryItem(node, depth) {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-tree-group';

    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-dir';
    button.style.paddingLeft = `${8 + depth * 16}px`;

    const isExpanded = this.expandedDirs.has(node.path);
    button.setAttribute('aria-expanded', String(isExpanded));

    button.innerHTML = `
      <svg class="file-tree-chevron${isExpanded ? ' expanded' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="file-tree-name">${this.escapeHtml(node.name)}</span>
    `;

    button.addEventListener('click', () => {
      if (this.expandedDirs.has(node.path)) {
        this.expandedDirs.delete(node.path);
      } else {
        this.expandedDirs.add(node.path);
      }
      this.renderTree();
    });

    wrapper.appendChild(button);

    if (isExpanded && node.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      this.renderNodes(node.children, childContainer, depth + 1);
      wrapper.appendChild(childContainer);
    }

    return wrapper;
  }

  createFileItem(name, filePath, depth) {
    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-file';
    if (filePath === this.activeFilePath) {
      button.classList.add('active');
    }
    button.style.paddingLeft = `${8 + depth * 16 + 14}px`;
    button.dataset.path = filePath;

    const displayName = name.replace(/\.md$/i, '');

    button.innerHTML = `
      <svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="file-tree-name">${this.escapeHtml(displayName)}</span>
    `;

    button.addEventListener('click', () => {
      this.onFileSelect?.(filePath);
    });

    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e, filePath);
    });

    return button;
  }

  showContextMenu(event, filePath) {
    this.removeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const renameBtn = document.createElement('button');
    renameBtn.className = 'file-context-item';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      this.removeContextMenu();
      this.handleRename(filePath);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'file-context-item file-context-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      this.removeContextMenu();
      this.handleDelete(filePath);
    });

    menu.append(renameBtn, deleteBtn);
    document.body.appendChild(menu);

    const close = (e) => {
      if (!menu.contains(e.target)) {
        this.removeContextMenu();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  removeContextMenu() {
    document.querySelectorAll('.file-context-menu').forEach((m) => m.remove());
  }

  async handleNewFile() {
    const name = prompt('New file name (e.g., "my-note.md"):');
    if (!name) return;

    const fileName = name.endsWith('.md') ? name : `${name}.md`;

    try {
      const response = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fileName, content: `# ${name.replace(/\.md$/i, '')}\n\n` }),
      });
      const data = await response.json();
      if (data.ok) {
        await this.refresh();
        this.onFileSelect?.(fileName);
      } else {
        alert(data.error || 'Failed to create file');
      }
    } catch (error) {
      alert(`Failed to create file: ${error.message}`);
    }
  }

  async handleNewFolder() {
    const name = prompt('New folder name:');
    if (!name) return;

    try {
      const response = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name }),
      });
      const data = await response.json();
      if (data.ok) {
        await this.refresh();
      } else {
        alert(data.error || 'Failed to create folder');
      }
    } catch (error) {
      alert(`Failed to create folder: ${error.message}`);
    }
  }

  async handleRename(filePath) {
    const currentName = filePath.split('/').pop();
    const newName = prompt('New name:', currentName);
    if (!newName || newName === currentName) return;

    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';
    const newPath = dir + (newName.endsWith('.md') ? newName : `${newName}.md`);

    try {
      const response = await fetch('/api/file', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: filePath, newPath }),
      });
      const data = await response.json();
      if (data.ok) {
        await this.refresh();
        if (this.activeFilePath === filePath) {
          this.onFileSelect?.(newPath);
        }
      } else {
        alert(data.error || 'Failed to rename');
      }
    } catch (error) {
      alert(`Failed to rename: ${error.message}`);
    }
  }

  async handleDelete(filePath) {
    if (!confirm(`Delete "${filePath}"?`)) return;

    try {
      const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.ok) {
        await this.refresh();
        if (this.activeFilePath === filePath) {
          this.onFileDelete?.(filePath);
        }
      } else {
        alert(data.error || 'Failed to delete');
      }
    } catch (error) {
      alert(`Failed to delete: ${error.message}`);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
