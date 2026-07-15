import { readdir, stat } from 'node:fs/promises';

import { isIgnoredVaultEntry, sanitizeVaultPath } from '../persistence/path-utils.js';

export function createWorkspaceStateFileSystemAdapter({ vaultDir }) {
  function resolveWorkspacePath(pathValue = '') {
    if (!vaultDir) {
      return null;
    }

    if (!pathValue) {
      return vaultDir;
    }

    return sanitizeVaultPath(vaultDir, pathValue);
  }

  return {
    isIgnoredEntry: isIgnoredVaultEntry,
    async readDirectory(pathValue = '') {
      const absolutePath = resolveWorkspacePath(pathValue);
      if (!absolutePath) {
        return [];
      }

      return readdir(absolutePath, { withFileTypes: true });
    },
    async stat(pathValue = '') {
      const absolutePath = resolveWorkspacePath(pathValue);
      if (!absolutePath) {
        return null;
      }

      return stat(absolutePath);
    },
  };
}
