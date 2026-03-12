import {
  getVaultTreeNodeType,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';
import { escapeHtml } from '../domain/vault-utils.js';

function getPathLeaf(path) {
  return String(path ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

export class FileExplorerView {
  constructor({
    onDirectoryToggle,
    onFileContextMenu,
    onFileSelect,
    onSearchChange,
    onTreeContextMenu,
  }) {
    this.onDirectoryToggle = onDirectoryToggle;
    this.onFileContextMenu = onFileContextMenu;
    this.onFileSelect = onFileSelect;
    this.onSearchChange = onSearchChange;
    this.onTreeContextMenu = onTreeContextMenu;
    this.treeContainer = document.getElementById('fileTree');
    this.searchInput = document.getElementById('fileSearchInput');
  }

  initialize() {
    this.searchInput?.addEventListener('input', (event) => {
      this.onSearchChange?.(event.target.value);
    });

    this.treeContainer?.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.file-tree-item')) {
        return;
      }

      event.preventDefault();
      this.onTreeContextMenu?.(event);
    });
  }

  render({ activeFilePath, expandedDirs, searchMatches, searchQuery, tree }) {
    if (!this.treeContainer) {
      return;
    }

    if (searchQuery) {
      this.renderSearchResults(searchMatches, activeFilePath);
      return;
    }

    this.treeContainer.innerHTML = '';

    if (tree.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No vault files found</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    this.renderNodes(tree, fragment, {
      activeFilePath,
      depth: 0,
      expandedDirs,
    });
    this.treeContainer.appendChild(fragment);
  }

  renderSearchResults(matches, activeFilePath) {
    if (!this.treeContainer) {
      return;
    }

    this.treeContainer.innerHTML = '';

    if (matches.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No matches</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const filePath of matches) {
      fragment.appendChild(this.createFileItem({
        activeFilePath,
        depth: 0,
        filePath,
        fileType: getVaultTreeNodeType(filePath) ?? 'file',
        name: getPathLeaf(filePath),
      }));
    }
    this.treeContainer.appendChild(fragment);
  }

  renderNodes(nodes, container, { activeFilePath, depth, expandedDirs }) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        container.appendChild(this.createDirectoryItem(node, {
          activeFilePath,
          depth,
          expandedDirs,
        }));
        continue;
      }

      container.appendChild(this.createFileItem({
        activeFilePath,
        depth,
        filePath: node.path,
        fileType: node.type,
        name: node.name,
      }));
    }
  }

  createDirectoryItem(node, { activeFilePath, depth, expandedDirs }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-tree-group';

    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-dir';
    button.style.setProperty('--depth', depth);
    button.dataset.depth = depth;

    const isExpanded = expandedDirs.has(node.path);
    button.setAttribute('aria-expanded', String(isExpanded));
    button.innerHTML = `
      <svg class="file-tree-chevron${isExpanded ? ' expanded' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="file-tree-name">${escapeHtml(node.name)}</span>
    `;

    button.addEventListener('click', () => {
      this.onDirectoryToggle?.(node.path);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onFileContextMenu?.(event, { directoryPath: node.path, type: 'directory' });
    });

    wrapper.appendChild(button);

    if (isExpanded && Array.isArray(node.children)) {
      const childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      this.renderNodes(node.children, childContainer, {
        activeFilePath,
        depth: depth + 1,
        expandedDirs,
      });
      wrapper.appendChild(childContainer);
    }

    return wrapper;
  }

  createFileItem({ activeFilePath, depth, filePath, fileType = 'file', name }) {
    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-file';
    const isExcalidraw = fileType === 'excalidraw';
    const isMermaid = fileType === 'mermaid';
    const isPlantUml = fileType === 'plantuml';

    if (isExcalidraw) {
      button.classList.add('is-excalidraw');
    }
    if (isMermaid) {
      button.classList.add('is-mermaid');
    }
    if (isPlantUml) {
      button.classList.add('is-plantuml');
    }
    if (filePath === activeFilePath) {
      button.classList.add('active');
    }

    button.style.setProperty('--depth', depth);
    button.dataset.depth = depth;
    button.dataset.path = filePath;
    button.innerHTML = `
      ${this.getFileIconSvg({ isExcalidraw, isMermaid, isPlantUml })}
      <span class="file-tree-name">${escapeHtml(stripVaultFileExtension(name))}</span>
    `;

    button.addEventListener('click', () => {
      this.onFileSelect?.(filePath);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onFileContextMenu?.(event, { filePath, type: 'file' });
    });

    return button;
  }

  getFileIconSvg({ isExcalidraw, isMermaid, isPlantUml }) {
    if (isExcalidraw) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>';
    }

    if (isMermaid) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5c0-1.38 1.12-2.5 2.5-2.5 1.04 0 1.93.64 2.3 1.56A2.5 2.5 0 0 1 14 8.5v1"/><path d="M19 16.5c0 1.38-1.12 2.5-2.5 2.5-1.04 0-1.93-.64-2.3-1.56A2.5 2.5 0 0 1 10 15.5v-1"/><path d="M8 10.5h8"/><path d="M8 13.5h8"/><path d="M10 8.5v7"/><path d="M14 8.5v7"/></svg>';
    }

    if (isPlantUml) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';
    }

    return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  showContextMenu(event, items) {
    this.removeContextMenu();

    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';

    for (const item of items) {
      const button = document.createElement('button');
      button.className = `file-context-item${item.danger ? ' file-context-danger' : ''}`;
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.removeContextMenu();
        item.onSelect?.();
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
    menu.style.left = `${Math.max(8, Math.min(event.clientX, maxLeft))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, maxTop))}px`;

    const close = (closeEvent) => {
      if (!menu.contains(closeEvent.target)) {
        this.removeContextMenu();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  removeContextMenu() {
    document.querySelectorAll('.file-context-menu').forEach((menu) => menu.remove());
  }
}
