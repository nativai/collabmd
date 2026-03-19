import { watch } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';

import { createWorkspaceChange } from '../../../domain/workspace-change.js';
import { isVaultFilePath } from '../../../domain/file-kind.js';
import {
  isIgnoredVaultEntry,
  sanitizeVaultPath,
} from '../persistence/path-utils.js';

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

export class FileSystemSyncService {
  constructor({
    debounceMs = 180,
    mutationCoordinator,
    vaultFileStore,
  }) {
    this.debounceMs = debounceMs;
    this.mutationCoordinator = mutationCoordinator;
    this.vaultFileStore = vaultFileStore;
    this.watcher = null;
    this.debounceTimer = null;
    this.runningFlush = null;
    this.lastState = null;
    this.pendingEventTypesByPath = new Map();
    this.forceFullScan = false;
    this.suspendWatchEventsUntil = 0;
  }

  async start() {
    this.lastState = this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
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

    if (
      this.pendingEventTypesByPath.size > 4
      || bucket.has('rename')
    ) {
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

  async resetForExternalStateChange() {
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
    this.lastState = this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
  }

  async readWorkspaceFileState(pathValue) {
    if (!pathValue || !isVaultFilePath(pathValue)) {
      return null;
    }

    const absolutePath = sanitizeVaultPath(this.vaultFileStore.vaultDir, pathValue);
    if (!absolutePath) {
      return null;
    }

    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        return null;
      }

      return {
        entry: this.lastState?.entries?.get(pathValue) ?? {
          fileKind: null,
          name: basename(pathValue),
          nodeType: 'file',
          parentPath: pathValue.includes('/') ? pathValue.slice(0, pathValue.lastIndexOf('/')) : '',
          path: pathValue,
          type: this.lastState?.entries?.get(pathValue)?.type ?? null,
        },
        metadata: {
          inode: Number(info.ino || 0),
          mtimeMs: Number(info.mtimeMs || 0),
          path: pathValue,
          size: Number(info.size || 0),
          type: 'file',
        },
      };
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return null;
      }

      throw error;
    }
  }

  async buildIncrementalSingleFileResult() {
    if (this.forceFullScan || this.pendingEventTypesByPath.size !== 1 || !this.lastState) {
      return null;
    }

    const [[pathValue, eventTypes]] = this.pendingEventTypesByPath.entries();
    if (!pathValue || !eventTypes || eventTypes.size !== 1 || !eventTypes.has('change')) {
      return null;
    }

    const previousMetadata = this.lastState.metadata?.get(pathValue);
    const previousEntry = this.lastState.entries?.get(pathValue);
    if (!previousMetadata || previousMetadata.type !== 'file' || !previousEntry) {
      return null;
    }

    const nextStateForPath = await this.readWorkspaceFileState(pathValue);
    if (!nextStateForPath?.metadata || entrySignature(previousMetadata) === entrySignature(nextStateForPath.metadata)) {
      return null;
    }

    const nextEntries = new Map(this.lastState.entries);
    const nextMetadata = new Map(this.lastState.metadata);
    nextEntries.set(pathValue, previousEntry);
    nextMetadata.set(pathValue, nextStateForPath.metadata);

    return {
      nextState: {
        entries: nextEntries,
        metadata: nextMetadata,
        scannedAt: Date.now(),
      },
      workspaceChange: createWorkspaceChange({
        changedPaths: [pathValue],
        deletedPaths: [],
        renamedPaths: [],
        refreshExplorer: true,
      }),
    };
  }

  consumePendingEvents() {
    const hadPendingEvents = this.pendingEventTypesByPath.size > 0 || this.forceFullScan;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    return hadPendingEvents;
  }

  async flush() {
    const incrementalResult = await this.buildIncrementalSingleFileResult();
    this.consumePendingEvents();

    const previousWorkspaceState = this.mutationCoordinator.workspaceState;
    const nextState = incrementalResult?.nextState ?? await this.vaultFileStore.scanWorkspaceState();
    const workspaceChange = incrementalResult?.workspaceChange ?? detectWorkspaceChange(this.lastState, nextState);
    this.lastState = nextState;

    const filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
    if (!filteredChange) {
      this.mutationCoordinator.syncWorkspaceEntries(nextState, {
        previousState: previousWorkspaceState,
      });
      this.mutationCoordinator.workspaceState = nextState;
      return;
    }

    await this.mutationCoordinator.apply({
      action: 'filesystem-sync',
      origin: 'filesystem',
      nextState,
      workspaceChange: filteredChange,
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
