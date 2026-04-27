import { watch } from 'fs';
import { readdir, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';

import { createWorkspaceChange } from '../../../domain/workspace-change.js';
import { getVaultTreeNodeType, isVaultFilePath } from '../../../domain/file-kind.js';
import { logPerfEvent } from '../../config/perf-logging.js';
import { createWorkspaceStateSnapshot } from '../../domain/workspace-state.js';
import {
  isIgnoredVaultEntry,
  sanitizeVaultPath,
} from '../persistence/path-utils.js';

const MAX_INCREMENTAL_PENDING_PATHS = 16;

function entrySignature(entry = {}) {
  return `${entry.type}:${entry.inode}:${entry.size}:${entry.mtimeMs}`;
}

function sortByPath(values = []) {
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function normalizeWatchedPath(filename) {
  if (typeof filename !== 'string' && !Buffer.isBuffer(filename)) {
    return '';
  }

  const normalized = String(filename).trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized === '.') {
    return '';
  }

  return normalized
    .split('/')
    .filter(Boolean)
    .join('/');
}

function isIgnoredWatchedPath(pathValue) {
  if (!pathValue) {
    return true;
  }

  const segments = String(pathValue).split('/').filter(Boolean);
  if (segments.length === 0) {
    return true;
  }

  if (segments.some((segment) => isIgnoredVaultEntry(segment))) {
    return true;
  }

  return basename(pathValue).includes('.collabmd-');
}

function normalizeWorkspacePath(pathValue = '') {
  return String(pathValue ?? '').replace(/\\/g, '/').trim();
}

function getParentDirectoryPath(pathValue = '') {
  const parentPath = dirname(normalizeWorkspacePath(pathValue)).replace(/\\/g, '/');
  return parentPath === '.' ? '' : parentPath;
}

function createWorkspaceEntry(pathValue, nodeType) {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  return {
    fileKind: nodeType === 'directory' ? null : getVaultTreeNodeType(normalizedPath),
    name: basename(normalizedPath),
    nodeType,
    parentPath: getParentDirectoryPath(normalizedPath),
    path: normalizedPath,
    type: nodeType === 'directory' ? 'directory' : getVaultTreeNodeType(normalizedPath),
  };
}

function createWorkspaceMetadata(pathValue, type, info) {
  return {
    inode: Number(info.ino || 0),
    mtimeMs: Number(info.mtimeMs || 0),
    path: pathValue,
    size: type === 'directory' ? 0 : Number(info.size || 0),
    type,
  };
}

function isPathWithinPrefix(pathValue, prefix) {
  return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

function collectAncestorPaths(pathValue = '') {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  if (!normalizedPath) {
    return [];
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const ancestors = [];
  let currentPath = '';
  for (let index = 0; index < Math.max(segments.length - 1, 0); index += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
    ancestors.push(currentPath);
  }

  return ancestors;
}

function collapsePendingPaths(paths = []) {
  const collapsed = [];
  for (const pathValue of sortByPath(paths.filter(Boolean))) {
    if (collapsed.some((existingPath) => isPathWithinPrefix(pathValue, existingPath))) {
      continue;
    }

    collapsed.push(pathValue);
  }

  return collapsed;
}

function collectPathsWithinPrefixes(paths = [], prefixes = []) {
  const collected = new Set();
  for (const pathValue of paths) {
    if (prefixes.some((prefix) => isPathWithinPrefix(pathValue, prefix))) {
      collected.add(pathValue);
    }
  }
  return collected;
}

function createScopedWorkspaceState(sourceState, scopedPaths = new Set()) {
  const entries = new Map();
  const metadata = new Map();

  scopedPaths.forEach((pathValue) => {
    const entry = sourceState?.entries?.get(pathValue);
    const entryMetadata = sourceState?.metadata?.get(pathValue);
    if (entry) {
      entries.set(pathValue, entry);
    }
    if (entryMetadata) {
      metadata.set(pathValue, entryMetadata);
    }
  });

  return {
    entries,
    metadata,
  };
}

function buildPrefixRenameEntries(previousState, nextState, oldPrefix, newPrefix) {
  const renames = [];
  previousState.metadata.forEach((entry, pathValue) => {
    if (entry.type !== 'file' || !pathValue.startsWith(`${oldPrefix}/`)) {
      return;
    }

    const suffix = pathValue.slice(oldPrefix.length + 1);
    const nextPath = `${newPrefix}/${suffix}`;
    if (nextState.metadata.get(nextPath)?.type === 'file') {
      renames.push({ oldPath: pathValue, newPath: nextPath });
    }
  });
  return renames;
}

function detectWorkspaceChange(previousState, nextState) {
  const previousMetadata = previousState?.metadata ?? new Map();
  const nextMetadata = nextState?.metadata ?? new Map();
  const changedPaths = new Set();
  const deletedPaths = new Set();
  const addedPaths = new Set();
  const renamedPaths = [];

  previousMetadata.forEach((previousEntry, pathValue) => {
    const nextEntry = nextMetadata.get(pathValue);
    if (!nextEntry) {
      if (previousEntry.type === 'file') {
        deletedPaths.add(pathValue);
      }
      return;
    }

    if (entrySignature(previousEntry) !== entrySignature(nextEntry) && nextEntry.type === 'file') {
      changedPaths.add(pathValue);
    }
  });

  nextMetadata.forEach((nextEntry, pathValue) => {
    if (!previousMetadata.has(pathValue) && nextEntry.type === 'file') {
      addedPaths.add(pathValue);
    }
  });

  const deletedBySignature = new Map();
  deletedPaths.forEach((pathValue) => {
    const metadata = previousMetadata.get(pathValue);
    const signature = entrySignature(metadata);
    const bucket = deletedBySignature.get(signature) ?? [];
    bucket.push(pathValue);
    deletedBySignature.set(signature, bucket);
  });

  const addedBySignature = new Map();
  addedPaths.forEach((pathValue) => {
    const metadata = nextMetadata.get(pathValue);
    const signature = entrySignature(metadata);
    const bucket = addedBySignature.get(signature) ?? [];
    bucket.push(pathValue);
    addedBySignature.set(signature, bucket);
  });

  Array.from(deletedBySignature.keys()).forEach((signature) => {
    const removed = deletedBySignature.get(signature) ?? [];
    const added = addedBySignature.get(signature) ?? [];
    if (removed.length === 1 && added.length === 1) {
      renamedPaths.push({ oldPath: removed[0], newPath: added[0] });
      deletedPaths.delete(removed[0]);
      addedPaths.delete(added[0]);
    }
  });

  const previousDirectories = Array.from(previousMetadata.entries())
    .filter(([, entry]) => entry.type === 'directory' && !nextMetadata.has(entry.path));
  const nextDirectories = Array.from(nextMetadata.entries())
    .filter(([, entry]) => entry.type === 'directory' && !previousMetadata.has(entry.path));

  previousDirectories.forEach(([oldPath, oldEntry]) => {
    const match = nextDirectories.find(([, nextEntry]) => entrySignature(oldEntry) === entrySignature(nextEntry));
    if (!match) {
      return;
    }

    const [newPath] = match;
    buildPrefixRenameEntries(previousState, nextState, oldPath, newPath).forEach((entry) => {
      renamedPaths.push(entry);
      deletedPaths.delete(entry.oldPath);
      addedPaths.delete(entry.newPath);
    });
  });

  addedPaths.forEach((pathValue) => {
    changedPaths.add(pathValue);
  });

  return createWorkspaceChange({
    changedPaths: sortByPath(Array.from(changedPaths)),
    deletedPaths: sortByPath(Array.from(deletedPaths)),
    renamedPaths,
    refreshExplorer: true,
  });
}

function hasWorkspacePaths(workspaceChange = {}) {
  return (
    (workspaceChange.changedPaths?.length ?? 0) > 0
    || (workspaceChange.deletedPaths?.length ?? 0) > 0
    || (workspaceChange.renamedPaths?.length ?? 0) > 0
  );
}

export class FileSystemSyncService {
  constructor({
    debounceMs = 180,
    mutationCoordinator,
    perfLoggingEnabled = false,
    vaultFileStore,
  }) {
    this.debounceMs = debounceMs;
    this.mutationCoordinator = mutationCoordinator;
    this.perfLoggingEnabled = perfLoggingEnabled;
    this.vaultFileStore = vaultFileStore;
    this.watcher = null;
    this.debounceTimer = null;
    this.runningFlush = null;
    this.lastState = null;
    this.pendingEventTypesByPath = new Map();
    this.forceFullScan = false;
    this.suspendWatchEventsUntil = 0;
  }

  async start({ snapshot = null } = {}) {
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
    this.watcher = watch(this.vaultFileStore.vaultDir, { recursive: true }, (eventType, filename) => {
      this.handleWatchEvent(eventType, filename);
    });
  }

  handleWatchEvent(eventType, filename) {
    if (Date.now() <= this.suspendWatchEventsUntil) {
      return;
    }

    const normalizedPath = normalizeWatchedPath(filename);
    if (!normalizedPath) {
      this.forceFullScan = true;
      this.scheduleFlush();
      return;
    }

    if (isIgnoredWatchedPath(normalizedPath)) {
      return;
    }

    const bucket = this.pendingEventTypesByPath.get(normalizedPath) ?? new Set();
    bucket.add(String(eventType || 'change'));
    this.pendingEventTypesByPath.set(normalizedPath, bucket);

    if (this.pendingEventTypesByPath.size > MAX_INCREMENTAL_PENDING_PATHS) {
      this.forceFullScan = true;
    }

    this.scheduleFlush();
  }

  scheduleFlush() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runningFlush = this.flush().finally(() => {
        this.runningFlush = null;
      });
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  async resetForExternalStateChange({ snapshot = null } = {}) {
    this.suspendWatchEventsUntil = Math.max(this.suspendWatchEventsUntil, Date.now() + 750);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;

    try {
      await this.runningFlush;
    } catch {
      // Ignore stale flush failures while rebaselining around an external reset.
    }

    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
  }

  async flushPendingChanges() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;

    if (this.runningFlush) {
      await this.runningFlush;
      return;
    }

    if (this.pendingEventTypesByPath.size === 0 && !this.forceFullScan) {
      return;
    }

    this.runningFlush = this.flush().finally(() => {
      this.runningFlush = null;
    });
    await this.runningFlush;
  }

  async readWorkspacePathSnapshot(pathValue) {
    const normalizedPath = normalizeWorkspacePath(pathValue);
    if (!normalizedPath) {
      return null;
    }

    const absolutePath = sanitizeVaultPath(this.vaultFileStore.vaultDir, normalizedPath);
    if (!absolutePath) {
      return null;
    }

    try {
      const info = await stat(absolutePath);
      const entries = new Map();
      const metadata = new Map();

      if (info.isDirectory()) {
        const visitDirectory = async (directoryPath, relativePath) => {
          entries.set(relativePath, createWorkspaceEntry(relativePath, 'directory'));
          metadata.set(relativePath, createWorkspaceMetadata(relativePath, 'directory', await stat(directoryPath)));

          let dirEntries;
          try {
            dirEntries = await readdir(directoryPath, { withFileTypes: true });
          } catch {
            return;
          }

          for (const entry of dirEntries) {
            if (isIgnoredVaultEntry(entry.name)) {
              continue;
            }

            const childAbsolutePath = join(directoryPath, entry.name);
            const childRelativePath = `${relativePath}/${entry.name}`.replace(/\\/g, '/');

            if (entry.isDirectory()) {
              await visitDirectory(childAbsolutePath, childRelativePath);
              continue;
            }

            if (!isVaultFilePath(childRelativePath)) {
              continue;
            }

            try {
              const childInfo = await stat(childAbsolutePath);
              if (!childInfo.isFile()) {
                continue;
              }

              entries.set(childRelativePath, createWorkspaceEntry(childRelativePath, 'file'));
              metadata.set(childRelativePath, createWorkspaceMetadata(childRelativePath, 'file', childInfo));
            } catch (error) {
              if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
                throw error;
              }
            }
          }
        };

        await visitDirectory(absolutePath, normalizedPath);
        return { entries, metadata };
      }

      if (!info.isFile() || !isVaultFilePath(normalizedPath)) {
        return { entries, metadata };
      }

      entries.set(normalizedPath, createWorkspaceEntry(normalizedPath, 'file'));
      metadata.set(normalizedPath, createWorkspaceMetadata(normalizedPath, 'file', info));
      return { entries, metadata };
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return {
          entries: new Map(),
          metadata: new Map(),
        };
      }

      throw error;
    }
  }

  async ensureAncestorDirectories(nextEntries, nextMetadata, pathValue) {
    const parentPath = getParentDirectoryPath(pathValue);
    if (!parentPath) {
      return true;
    }

    const segments = parentPath.split('/').filter(Boolean);
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (nextEntries.has(currentPath) && nextMetadata.has(currentPath)) {
        continue;
      }

      const directorySnapshot = await this.readWorkspacePathSnapshot(currentPath);
      if (!directorySnapshot?.entries?.has(currentPath) || !directorySnapshot.metadata?.has(currentPath)) {
        return false;
      }

      nextEntries.set(currentPath, directorySnapshot.entries.get(currentPath));
      nextMetadata.set(currentPath, directorySnapshot.metadata.get(currentPath));
    }

    return true;
  }

  async buildIncrementalResult() {
    if (this.forceFullScan) {
      return { fallbackReason: 'forced-full-scan', incrementalResult: null };
    }

    if (this.pendingEventTypesByPath.size === 0) {
      return { fallbackReason: 'no-pending-paths', incrementalResult: null };
    }

    if (!this.lastState) {
      return { fallbackReason: 'missing-last-state', incrementalResult: null };
    }

    const pendingPaths = collapsePendingPaths(Array.from(this.pendingEventTypesByPath.keys()));
    if (pendingPaths.length === 0 || pendingPaths.length > MAX_INCREMENTAL_PENDING_PATHS) {
      return { fallbackReason: 'too-many-pending-paths', incrementalResult: null };
    }

    const nextEntries = new Map(this.lastState.entries);
    const nextMetadata = new Map(this.lastState.metadata);
    const previousState = this.lastState;
    const previousTouchedPaths = collectPathsWithinPrefixes(previousState.entries.keys(), pendingPaths);
    const nextTouchedPaths = new Set();

    pendingPaths.forEach((pathValue) => {
      collectAncestorPaths(pathValue).forEach((ancestorPath) => {
        if (previousState.entries.has(ancestorPath)) {
          previousTouchedPaths.add(ancestorPath);
        }
      });
    });

    previousTouchedPaths.forEach((pathValue) => {
      nextEntries.delete(pathValue);
      nextMetadata.delete(pathValue);
    });

    for (const pathValue of pendingPaths) {
      const snapshot = await this.readWorkspacePathSnapshot(pathValue);
      if (!snapshot) {
        return { fallbackReason: 'snapshot-unavailable', incrementalResult: null };
      }

      if (!(await this.ensureAncestorDirectories(nextEntries, nextMetadata, pathValue))) {
        return { fallbackReason: 'ancestor-missing', incrementalResult: null };
      }

      collectAncestorPaths(pathValue).forEach((ancestorPath) => {
        if (nextEntries.has(ancestorPath)) {
          nextTouchedPaths.add(ancestorPath);
        }
      });

      snapshot.entries.forEach((entry, entryPath) => {
        nextEntries.set(entryPath, entry);
        nextTouchedPaths.add(entryPath);
      });
      snapshot.metadata.forEach((metadata, metadataPath) => {
        nextMetadata.set(metadataPath, metadata);
      });
    }

    const nextState = createWorkspaceStateSnapshot(nextEntries, nextMetadata, {
      scannedAt: Date.now(),
    });
    const workspaceChange = detectWorkspaceChange(
      createScopedWorkspaceState(previousState, previousTouchedPaths),
      createScopedWorkspaceState(nextState, nextTouchedPaths),
    );

    return {
      fallbackReason: '',
      incrementalResult: {
        nextState,
        workspaceChange,
      },
    };
  }

  consumePendingEvents() {
    const hadPendingEvents = this.pendingEventTypesByPath.size > 0 || this.forceFullScan;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    return hadPendingEvents;
  }

  async flush() {
    const startedAt = Date.now();
    const pendingPathCount = this.pendingEventTypesByPath.size;
    const { fallbackReason, incrementalResult } = await this.buildIncrementalResult();
    this.consumePendingEvents();

    const previousWorkspaceState = this.mutationCoordinator.workspaceState;
    const authoritativePreviousState = previousWorkspaceState ?? this.lastState;
    let effectiveMode = incrementalResult ? 'incremental' : 'full-scan';
    let effectiveFallbackReason = fallbackReason;
    let nextState = incrementalResult?.nextState ?? await this.vaultFileStore.scanWorkspaceState();
    let workspaceChange = incrementalResult?.workspaceChange ?? detectWorkspaceChange(this.lastState, nextState);
    this.lastState = nextState;

    let filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
    if (!filteredChange) {
      const authoritativeChange = detectWorkspaceChange(authoritativePreviousState, nextState);
      if (hasWorkspacePaths(authoritativeChange)) {
        nextState = await this.vaultFileStore.scanWorkspaceState();
        workspaceChange = detectWorkspaceChange(authoritativePreviousState, nextState);
        this.lastState = nextState;
        filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
        effectiveMode = 'full-scan';
        effectiveFallbackReason = effectiveFallbackReason || 'authoritative-rebase';
      }
    }

    if (!filteredChange) {
      if (this.mutationCoordinator.isGloballySuppressed?.() || hasWorkspacePaths(workspaceChange)) {
        this.mutationCoordinator.syncWorkspaceEntries(nextState, {
          previousState: previousWorkspaceState,
        });
        this.mutationCoordinator.replaceWorkspaceState(nextState);
      }

      logPerfEvent(this.perfLoggingEnabled, 'filesystem-sync', {
        changedPathCount: workspaceChange.changedPaths?.length ?? 0,
        deletedPathCount: workspaceChange.deletedPaths?.length ?? 0,
        durationMs: Date.now() - startedAt,
        fallbackReason: effectiveFallbackReason,
        mode: effectiveMode,
        pendingPathCount,
        renamedPathCount: workspaceChange.renamedPaths?.length ?? 0,
      });
      return;
    }

    await this.mutationCoordinator.apply({
      action: 'filesystem-sync',
      origin: 'filesystem',
      nextState,
      workspaceChange: filteredChange,
    });
    logPerfEvent(this.perfLoggingEnabled, 'filesystem-sync', {
      changedPathCount: filteredChange.changedPaths?.length ?? 0,
      deletedPathCount: filteredChange.deletedPaths?.length ?? 0,
      durationMs: Date.now() - startedAt,
      fallbackReason: effectiveFallbackReason,
      mode: effectiveMode,
      pendingPathCount,
      renamedPathCount: filteredChange.renamedPaths?.length ?? 0,
    });
  }

  async close() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    await this.runningFlush;
  }
}
