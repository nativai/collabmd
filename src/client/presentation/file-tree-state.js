import { normalizeVaultPathInput } from '../domain/vault-paths.js';

function flattenTree(nodes, files = []) {
  for (const node of nodes) {
    if (
      node.type === 'file'
      || node.type === 'excalidraw'
      || node.type === 'mermaid'
      || node.type === 'plantuml'
      || node.type === 'image'
    ) {
      files.push(node.path);
      continue;
    }

    if (node.type === 'directory' && Array.isArray(node.children)) {
      flattenTree(node.children, files);
    }
  }

  return files;
}

export class FileTreeState {
  constructor() {
    this.tree = [];
    this.flatFiles = [];
    this.activeFilePath = null;
    this.expandedDirs = new Set();
    this.searchQuery = '';
  }

  setTree(tree) {
    this.tree = Array.isArray(tree) ? tree : [];
    this.flatFiles = flattenTree(this.tree, []);
  }

  setSearchQuery(value) {
    this.searchQuery = String(value ?? '').trim().toLowerCase();
  }

  getSearchMatches() {
    if (!this.searchQuery) {
      return [];
    }

    return this.flatFiles.filter((path) => path.toLowerCase().includes(this.searchQuery));
  }

  setActiveFile(filePath) {
    this.activeFilePath = filePath || null;

    if (filePath) {
      this.expandDirectoryPath(filePath, { includeLeaf: false });
    }
  }

  toggleDirectory(pathValue) {
    if (this.expandedDirs.has(pathValue)) {
      this.expandedDirs.delete(pathValue);
      return false;
    }

    this.expandedDirs.add(pathValue);
    return true;
  }

  expandDirectoryPath(pathValue, { includeLeaf = true } = {}) {
    const normalized = normalizeVaultPathInput(pathValue);
    if (!normalized) {
      return;
    }

    const segments = normalized.split('/');
    const segmentCount = includeLeaf ? segments.length : Math.max(segments.length - 1, 0);
    let currentPath = '';

    for (let index = 0; index < segmentCount; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      this.expandedDirs.add(currentPath);
    }
  }
}
