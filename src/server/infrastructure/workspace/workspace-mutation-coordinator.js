import { supportsBacklinksForFilePath } from '../../../domain/file-kind.js';
import {
  createEmptyWorkspaceChange,
  createWorkspaceChange,
  normalizeWorkspaceEvent,
} from '../../../domain/workspace-change.js';
import { WORKSPACE_ROOM_NAME } from '../../../domain/workspace-room.js';

function createEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function countWorkspacePaths(workspaceChange = {}) {
  return (
    (workspaceChange.changedPaths?.length ?? 0)
    + (workspaceChange.deletedPaths?.length ?? 0)
    + (workspaceChange.renamedPaths?.length ?? 0)
  );
}

function normalizePaths(paths = []) {
  return Array.from(new Set((paths ?? []).filter(Boolean)));
}

function workspaceEntriesEqual(left = {}, right = {}) {
  return (
    left.fileKind === right.fileKind
    && left.name === right.name
    && left.nodeType === right.nodeType
    && left.parentPath === right.parentPath
    && left.path === right.path
    && left.type === right.type
  );
}

function diffWorkspaceEntries(previousEntries = new Map(), nextEntries = new Map()) {
  const upserts = new Map();
  const deletes = [];

  previousEntries.forEach((previousEntry, pathValue) => {
    const nextEntry = nextEntries.get(pathValue);
    if (!nextEntry) {
      deletes.push(pathValue);
      return;
    }

    if (!workspaceEntriesEqual(previousEntry, nextEntry)) {
      upserts.set(pathValue, nextEntry);
    }
  });

  nextEntries.forEach((nextEntry, pathValue) => {
    if (!previousEntries.has(pathValue)) {
      upserts.set(pathValue, nextEntry);
    }
  });

  return { deletes, upserts };
}

export class WorkspaceMutationCoordinator {
  constructor({
    backlinkIndex,
    roomRegistry,
    vaultFileStore,
    managedWriteWindowMs = 1200,
  }) {
    this.backlinkIndex = backlinkIndex ?? null;
    this.roomRegistry = roomRegistry;
    this.vaultFileStore = vaultFileStore;
    this.managedWriteWindowMs = managedWriteWindowMs;
    this.managedPathExpiry = new Map();
    this.globalSuppressionUntil = 0;
    this.workspaceState = null;
  }

  getWorkspaceRoom() {
    return this.roomRegistry?.getOrCreate?.(WORKSPACE_ROOM_NAME) ?? null;
  }

  syncWorkspaceEntries(nextState, {
    previousState = this.workspaceState,
  } = {}) {
    const room = this.getWorkspaceRoom();
    if (!room || !nextState) {
      return false;
    }

    const patch = diffWorkspaceEntries(
      previousState?.entries ?? new Map(),
      nextState.entries ?? new Map(),
    );
    return room.applyWorkspaceEntryPatch(patch, {
      generatedAt: nextState.scannedAt,
    });
  }

  async initialize() {
    const snapshot = await this.vaultFileStore.scanWorkspaceState();
    this.workspaceState = snapshot;
    this.getWorkspaceRoom()?.replaceWorkspaceEntries(snapshot.entries, {
      generatedAt: snapshot.scannedAt,
    });
    return snapshot;
  }

  markManagedPaths(paths = [], { durationMs = this.managedWriteWindowMs } = {}) {
    const expiresAt = Date.now() + durationMs;
    normalizePaths(paths).forEach((pathValue) => {
      this.managedPathExpiry.set(pathValue, expiresAt);
    });
  }

  runManagedWrite(paths = [], operation) {
    this.markManagedPaths(paths);
    return Promise.resolve(operation()).finally(() => {
      this.markManagedPaths(paths);
    });
  }

  async runManagedWorkspaceMutation(operation) {
    this.globalSuppressionUntil = Math.max(this.globalSuppressionUntil, Date.now() + this.managedWriteWindowMs);
    try {
      return await operation();
    } finally {
      this.globalSuppressionUntil = Math.max(this.globalSuppressionUntil, Date.now() + this.managedWriteWindowMs);
    }
  }

  isGloballySuppressed() {
    return Date.now() <= this.globalSuppressionUntil;
  }

  cleanupExpiredManagedPaths() {
    const now = Date.now();
    Array.from(this.managedPathExpiry.entries()).forEach(([pathValue, expiresAt]) => {
      if (expiresAt <= now) {
        this.managedPathExpiry.delete(pathValue);
      }
    });
  }

  isManagedPath(pathValue) {
    this.cleanupExpiredManagedPaths();
    const expiresAt = this.managedPathExpiry.get(pathValue);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  filterManagedWorkspaceChange(workspaceChange = {}) {
    if (this.isGloballySuppressed()) {
      return null;
    }

    const filtered = createWorkspaceChange({
      changedPaths: (workspaceChange.changedPaths ?? []).filter((pathValue) => !this.isManagedPath(pathValue)),
      deletedPaths: (workspaceChange.deletedPaths ?? []).filter((pathValue) => !this.isManagedPath(pathValue)),
      renamedPaths: (workspaceChange.renamedPaths ?? []).filter((entry) => (
        entry?.oldPath
        && entry?.newPath
        && !this.isManagedPath(entry.oldPath)
        && !this.isManagedPath(entry.newPath)
      )),
      refreshExplorer: workspaceChange.refreshExplorer !== false,
    });

    if (countWorkspacePaths(filtered) === 0) {
      return null;
    }

    return filtered;
  }

  async reconcileBacklinks(workspaceChange, nextState, {
    forceRebuild = false,
  } = {}) {
    if (!this.backlinkIndex) {
      return;
    }

    const previousEntries = this.workspaceState?.entries ?? new Map();
    if (
      forceRebuild
      || (workspaceChange.renamedPaths?.length ?? 0) > 0
      || countWorkspacePaths(workspaceChange) > 25
    ) {
      await this.backlinkIndex.build();
      return;
    }

    for (const pathValue of workspaceChange.deletedPaths ?? []) {
      if (supportsBacklinksForFilePath(pathValue)) {
        this.backlinkIndex.onFileDeleted(pathValue);
      }
    }

    for (const entry of workspaceChange.renamedPaths ?? []) {
      if (supportsBacklinksForFilePath(entry.oldPath) || supportsBacklinksForFilePath(entry.newPath)) {
        this.backlinkIndex.onFileRenamed(entry.oldPath, entry.newPath);
      }
    }

    for (const pathValue of workspaceChange.changedPaths ?? []) {
      if (!supportsBacklinksForFilePath(pathValue)) {
        continue;
      }

      const existsNow = nextState.entries.has(pathValue);
      const existedBefore = previousEntries.has(pathValue);
      if (!existsNow) {
        if (existedBefore) {
          this.backlinkIndex.onFileDeleted(pathValue);
        }
        continue;
      }

      const content = await this.vaultFileStore.readMarkdownFile(pathValue);
      if (content === null) {
        continue;
      }

      if (existedBefore) {
        this.backlinkIndex.updateFile(pathValue, content);
      } else {
        this.backlinkIndex.onFileCreated(pathValue, content);
      }
    }
  }

  async apply({
    action = 'workspace',
    origin = 'api',
    publishEvent = true,
    requestId = null,
    sourceRef = null,
    workspaceChange = createEmptyWorkspaceChange(),
    nextState = null,
    forceBacklinkRebuild = false,
  } = {}) {
    const normalizedChange = createWorkspaceChange(workspaceChange);
    const previousState = this.workspaceState;
    const resolvedState = nextState ?? await this.vaultFileStore.scanWorkspaceState();

    await this.vaultFileStore.reconcileSidecars?.(normalizedChange);
    await this.vaultFileStore.reconcileCollaborationSnapshots?.(normalizedChange);
    await this.reconcileBacklinks(normalizedChange, resolvedState, {
      forceRebuild: forceBacklinkRebuild,
    });

    const roomEffects = await this.roomRegistry?.reconcileWorkspaceChange?.(normalizedChange) ?? {};
    const highlightRanges = normalizePaths(
      (roomEffects.highlightRanges ?? []).map((entry) => entry?.path),
    ).map((pathValue) => roomEffects.highlightRanges.find((entry) => entry.path === pathValue));
    const reloadRequiredPaths = normalizePaths(roomEffects.reloadRequiredPaths ?? []);

    this.syncWorkspaceEntries(resolvedState, {
      previousState,
    });
    this.workspaceState = resolvedState;

    if (!publishEvent) {
      return null;
    }

    const event = normalizeWorkspaceEvent({
      action,
      createdAt: Date.now(),
      highlightRanges,
      id: createEventId(),
      origin,
      reloadRequiredPaths,
      requestId,
      sourceRef,
      workspaceChange: normalizedChange,
    });
    this.getWorkspaceRoom()?.publishWorkspaceEvent(event);
    return event;
  }
}
