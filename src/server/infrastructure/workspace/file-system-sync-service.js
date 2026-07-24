import { watch } from 'node:fs';
import { basename } from 'node:path';

import { isVaultFilePath } from '../../../domain/file-kind.js';
import { logPerfEvent } from '../../config/perf-logging.js';
import {
  deriveIncrementalWorkspaceState,
  detectWorkspaceStateChange,
  hasWorkspaceStatePaths,
  readWorkspacePathSnapshot as readWorkspacePathSnapshotFromAdapter,
} from '../../domain/workspace-state.js';
import { isIgnoredVaultEntry, sanitizeVaultPath } from '../persistence/path-utils.js';
import { createWorkspaceStateFileSystemAdapter } from './workspace-state-file-system-adapter.js';

const MAX_INCREMENTAL_PENDING_PATHS = 16;

// Default ceiling on the number of inotify watches this service places.
//
// On Linux, `fs.watch(dir, { recursive: true })` is implemented by placing ONE
// inotify watch per directory. A large vault (tens of thousands of directories)
// therefore exhausts `fs.inotify.max_user_watches`, and the resulting ENOSPC
// surfaces as an unhandled `'error'` on the FSWatcher — crashing the process
// (exit 1). Vaults whose directory count stays at or below this cap keep the
// simple whole-vault recursive watch (no behaviour change for small vaults);
// larger vaults switch to a bounded, navigation-scoped strategy that never
// exceeds the cap. 4096 sits well under the common 8192-default kernel limit and
// leaves headroom for co-resident pods sharing the node-global inotify budget.
const DEFAULT_MAX_WATCHES = 4096;

function toForwardSlashPath(pathValue) {
  return String(pathValue ?? '').replace(/\\/g, '/');
}

function parentDirectoryOf(pathValue) {
  const normalized = toForwardSlashPath(pathValue);
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex === -1 ? '' : normalized.slice(0, separatorIndex);
}

// Re-root a per-directory watcher's `filename` (which fs.watch reports relative to
// the watched directory) onto a vault-relative path. This is the path contract: a
// non-recursive `fs.watch(subdir, cb)` reports names relative to `subdir`, while
// `handleWatchEvent` expects vault-root-relative paths. Missing this join makes
// live-reload silently report the wrong paths.
function joinVaultRelativePath(directory, filename) {
  const name = toForwardSlashPath(filename);
  if (!directory) {
    return name;
  }
  return `${toForwardSlashPath(directory)}/${name}`;
}

function isDirectoryEntry(entry) {
  return entry?.type === 'directory' || entry?.nodeType === 'directory';
}

// Vault-relative directory paths from a workspace snapshot, ordered breadth-first
// (shallowest directories first). `scanWorkspaceState` already excludes ignored
// entries (.git, node_modules, dotfiles), so the returned list honours the vault
// ignore rules for free — the recursive `fs.watch` does NOT filter, but this does.
function collectDirectoriesByDepth(state) {
  const directories = [];
  const entries = state?.entries;
  if (entries) {
    for (const [pathValue, entry] of entries) {
      if (isDirectoryEntry(entry)) {
        directories.push(pathValue);
      }
    }
  }

  return directories.sort((left, right) => {
    const depthLeft = left.split('/').length;
    const depthRight = right.split('/').length;
    if (depthLeft !== depthRight) {
      return depthLeft - depthRight;
    }
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  });
}

// Funnels every inotify watch this service holds through one place: it enforces a
// hard cap, attaches a graceful `'error'` handler to EVERY watcher, and translates
// per-directory event filenames to vault-relative paths (the path contract above).
// Small vaults use one recursive watch; large vaults fill it on demand as clients
// open files / expand directories (Phase 2), reference-counted so a directory wanted
// by several sources (an open room AND an expanded tree node) holds a single watch
// that survives until the last source releases it.
export class WatchRegistry {
  constructor({ vaultDir, maxWatches, onEvent, onDegrade }) {
    this.vaultDir = vaultDir;
    this.maxWatches = Number.isFinite(maxWatches) && maxWatches >= 0
      ? Math.floor(maxWatches)
      : DEFAULT_MAX_WATCHES;
    this.onEvent = onEvent;
    this.onDegrade = onDegrade;
    this.watchers = new Map();
    // Reference counts per vault-relative directory. A directory with count > 0 is
    // WANTED; it holds a live watcher iff it is also present in `this.watchers`
    // (a wanted directory can be unplaced when the cap is full — promoted later).
    this.refCounts = new Map();
    this.recursiveWatcher = null;
    this.degraded = false;
  }

  get size() {
    return this.watchers.size + (this.recursiveWatcher ? 1 : 0);
  }

  hasCapacity() {
    return this.size < this.maxWatches;
  }

  // Small-vault path: today's whole-vault recursive watch, but with a graceful
  // `'error'` handler so an ENOSPC (or any watch error) degrades instead of crashing.
  watchRecursive() {
    if (this.recursiveWatcher) {
      return true;
    }
    try {
      const watcher = watch(this.vaultDir, { recursive: true }, (eventType, filename) => {
        // Recursive events already carry vault-root-relative filenames.
        this.onEvent(eventType, filename == null ? null : filename);
      });
      watcher.on('error', (error) => this.handleWatcherError(error, ''));
      this.recursiveWatcher = watcher;
      return true;
    } catch (error) {
      this.handleWatcherError(error, '');
      return false;
    }
  }

  // Reference a directory as wanted. First reference (0→1) places a non-recursive
  // watch (`''` = vault root) if the cap allows; further references just bump the
  // count so the watch survives until every source releases it. Returns whether a
  // live watcher currently backs the directory.
  retain(vaultRelDir) {
    const directory = toForwardSlashPath(vaultRelDir);
    const nextCount = (this.refCounts.get(directory) ?? 0) + 1;
    this.refCounts.set(directory, nextCount);
    if (this.watchers.has(directory)) {
      return true;
    }
    return this.placeWatch(directory);
  }

  // Release one reference. When the last reference drops (→0) the watch is closed
  // and a wanted-but-unplaced directory (if any) is promoted into the freed slot.
  release(vaultRelDir) {
    const directory = toForwardSlashPath(vaultRelDir);
    const currentCount = this.refCounts.get(directory) ?? 0;
    if (currentCount <= 1) {
      this.refCounts.delete(directory);
      if (this.closeWatch(directory)) {
        this.promoteWantedWatch();
      }
      return;
    }
    this.refCounts.set(directory, currentCount - 1);
  }

  refCount(vaultRelDir) {
    return this.refCounts.get(toForwardSlashPath(vaultRelDir)) ?? 0;
  }

  // Create one non-recursive watch over a single directory, honouring the cap.
  // Returns true iff a live watcher now backs the directory.
  placeWatch(directory) {
    if (this.watchers.has(directory)) {
      return true;
    }
    if (!this.hasCapacity()) {
      // Wanted but no budget — recorded in refCounts, promoted when a slot frees.
      // Surfaced once as degradation so operators can see the cap is binding.
      this.handleWatcherError({ code: 'ECAP', message: 'watch cap reached' }, directory);
      return false;
    }

    const absoluteDir = directory ? sanitizeVaultPath(this.vaultDir, directory) : this.vaultDir;
    if (!absoluteDir) {
      return false;
    }

    try {
      const watcher = watch(absoluteDir, (eventType, filename) => {
        const vaultRelative = filename == null ? null : joinVaultRelativePath(directory, filename);
        this.onEvent(eventType, vaultRelative);
      });
      watcher.on('error', (error) => this.handleWatcherError(error, directory));
      this.watchers.set(directory, watcher);
      return true;
    } catch (error) {
      this.handleWatcherError(error, directory);
      return false;
    }
  }

  closeWatch(directory) {
    const watcher = this.watchers.get(directory);
    if (!watcher) {
      return false;
    }
    try {
      watcher.close();
    } catch {
      // best-effort close
    }
    this.watchers.delete(directory);
    return true;
  }

  // Fill a freed slot with any directory that is still wanted (refCount > 0) but has
  // no live watcher — keeps the "watch what's in view" set as complete as the cap allows.
  promoteWantedWatch() {
    if (!this.hasCapacity()) {
      return;
    }
    for (const directory of this.refCounts.keys()) {
      if (!this.watchers.has(directory)) {
        if (this.placeWatch(directory)) {
          return;
        }
      }
    }
  }

  // Idempotent by design: the JS recursive walker can emit repeated `'error'`
  // events, and multiple per-dir watchers can trip ENOSPC — so we log exactly once,
  // never re-throw. Live-reload for unwatched areas is lost; the editor stays up.
  handleWatcherError(error, vaultRelDir) {
    if (this.degraded) {
      return;
    }
    this.degraded = true;
    this.onDegrade?.({
      code: error?.code ?? 'UNKNOWN',
      message: error?.message ?? String(error),
      path: vaultRelDir,
      watchCount: this.size,
    });
  }

  closeAll() {
    if (this.recursiveWatcher) {
      try {
        this.recursiveWatcher.close();
      } catch {
        // best-effort close
      }
      this.recursiveWatcher = null;
    }
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // best-effort close
      }
    }
    this.watchers.clear();
    this.refCounts.clear();
  }
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

export class FileSystemSyncService {
  constructor({
    debounceMs = 180,
    maxWatches = DEFAULT_MAX_WATCHES,
    mutationCoordinator,
    perfLoggingEnabled = false,
    roomRegistry = null,
    vaultFileStore,
  }) {
    this.debounceMs = debounceMs;
    this.maxWatches = Number.isFinite(maxWatches) && maxWatches >= 0
      ? Math.floor(maxWatches)
      : DEFAULT_MAX_WATCHES;
    this.mutationCoordinator = mutationCoordinator;
    this.perfLoggingEnabled = perfLoggingEnabled;
    this.roomRegistry = roomRegistry;
    this.vaultFileStore = vaultFileStore;
    this.workspaceStateAdapter = createWorkspaceStateFileSystemAdapter({
      vaultDir: vaultFileStore?.vaultDir,
    });
    this.watchRegistry = null;
    this.watchMode = null;
    this.debounceTimer = null;
    this.runningFlush = null;
    this.lastState = null;
    this.pendingEventTypesByPath = new Map();
    this.forceFullScan = false;
    this.suspendWatchEventsUntil = 0;
    // Phase 2 (lazy mode) demand-tracking. Each source keeps the set of directories
    // it currently holds a reference on, so a change reconciles by diffing the fresh
    // desired set against the applied set (drift-free — recomputed from ground truth).
    this.appliedRoomDirs = new Set(); // directories of currently-open file rooms
    this.appliedSubscribedDirs = new Set(); // directories clients have expanded
  }

  async start({ snapshot = null } = {}) {
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();

    this.watchRegistry = new WatchRegistry({
      vaultDir: this.vaultFileStore.vaultDir,
      maxWatches: this.maxWatches,
      onEvent: (eventType, filename) => this.handleWatchEvent(eventType, filename),
      onDegrade: (info) => this.handleWatchDegraded(info),
    });

    const directories = collectDirectoriesByDepth(this.lastState);
    if (directories.length <= this.maxWatches) {
      // Small vault: unchanged behaviour — one recursive watch over the whole tree.
      this.watchMode = 'recursive';
      this.watchRegistry.watchRecursive();
    } else {
      // Large vault: watch only what's in view, filled on demand (Phase 2).
      this.watchMode = 'lazy';
      // The vault root is always watched (permanent reference): top-of-tree
      // add/remove/rename stays live regardless of what clients have open/expanded.
      this.watchRegistry.retain('');
      // Any files already open at start (e.g. after a restart / reconnect) get their
      // directories watched immediately — the rest is filled as clients interact.
      this.reconcileOpenRoomWatches();
    }

    this.logWatchMode({ directoryCount: directories.length, watchCount: this.watchRegistry.size });
  }

  // Lazy mode only: reconcile the set of watched open-file directories against the
  // live room registry (ground truth). Called whenever a file room opens or closes,
  // so a file opened LATER in a deep directory gets a watch (the Phase 1 gap), and a
  // directory whose last open file closed is released. Diffing against the applied
  // set makes this idempotent and drift-free.
  reconcileOpenRoomWatches() {
    if (this.watchMode !== 'lazy' || !this.watchRegistry) {
      return;
    }
    const desired = this.collectOpenRoomDirectories();
    this.applyDirectoryDiff(this.appliedRoomDirs, desired);
    this.appliedRoomDirs = desired;
  }

  onRoomOpened() {
    this.reconcileOpenRoomWatches();
  }

  onRoomClosed() {
    this.reconcileOpenRoomWatches();
  }

  // Lazy mode only: reconcile the set of watched client-expanded directories.
  // `subscriptions` carries the aggregate the workspace room extracts from Yjs
  // awareness: `dirs` = union of every connected client's expanded directories,
  // `activeFiles` = each client's currently-open file. Newly-subscribed directories
  // are re-read once (on-expand reconcile) so they are correct even if a watch could
  // not be placed; active files are re-read (on-focus reconcile) so an open file
  // stays current even when its watch is absent (degraded / cap reached).
  updateWatchSubscriptions({ dirs = [], activeFiles = [] } = {}) {
    if (this.watchMode !== 'lazy' || !this.watchRegistry) {
      return;
    }

    const desired = new Set();
    for (const dir of dirs) {
      const normalized = normalizeWatchedPath(dir);
      if (normalized && !isIgnoredWatchedPath(normalized)) {
        desired.add(normalized);
      }
    }

    const added = this.applyDirectoryDiff(this.appliedSubscribedDirs, desired);
    this.appliedSubscribedDirs = desired;

    // On-expand reconcile: re-read each newly-subscribed directory once.
    for (const directory of added) {
      this.requestPathReconcile(directory);
    }

    // On-focus / navigation reconcile: re-read each client's open file (cheap single
    // stat) so its content stays live even without a directory watch.
    for (const activeFile of activeFiles) {
      const normalized = normalizeWatchedPath(activeFile);
      if (normalized && isVaultFilePath(normalized) && !isIgnoredWatchedPath(normalized)) {
        this.requestPathReconcile(normalized);
      }
    }
  }

  // Retain directories newly in `desired`, release ones no longer wanted. Returns the
  // set of directories that were newly retained (for on-expand reconcile).
  applyDirectoryDiff(applied, desired) {
    const added = new Set();
    for (const directory of desired) {
      if (!applied.has(directory)) {
        this.watchRegistry.retain(directory);
        added.add(directory);
      }
    }
    for (const directory of applied) {
      if (!desired.has(directory)) {
        this.watchRegistry.release(directory);
      }
    }
    return added;
  }

  // Feed a path through the existing pending/flush pipeline exactly as a watch event
  // would — `deriveIncrementalWorkspaceState` re-reads its snapshot and diffs, so a
  // directory reconciles its subtree (add/remove/rename) and a file reconciles its
  // content. This is the belt to the watching braces: correctness of the viewed scope
  // no longer depends on a watch actually existing.
  requestPathReconcile(pathValue) {
    const normalizedPath = normalizeWatchedPath(pathValue);
    if (!normalizedPath || isIgnoredWatchedPath(normalizedPath)) {
      return;
    }
    const bucket = this.pendingEventTypesByPath.get(normalizedPath) ?? new Set();
    bucket.add('reconcile');
    this.pendingEventTypesByPath.set(normalizedPath, bucket);
    if (this.pendingEventTypesByPath.size > MAX_INCREMENTAL_PENDING_PATHS) {
      this.forceFullScan = true;
    }
    this.scheduleFlush();
  }

  // Directories of currently-open files (rooms keyed by vault-relative file path).
  // Transient rooms (__lobby__, the workspace room, drawio leases) are not vault
  // file paths, so `isVaultFilePath` filters them out.
  collectOpenRoomDirectories() {
    const entries = this.roomRegistry?.getRooms?.() ?? [];
    const directories = new Set();
    for (const [name] of entries) {
      if (typeof name === 'string' && isVaultFilePath(name)) {
        directories.add(parentDirectoryOf(name));
      }
    }
    return directories;
  }

  handleWatchDegraded(info) {
    console.warn(
      '[filesystem-sync] file watcher degraded — live-reload limited for unwatched paths; '
      + `process staying up. code=${info.code} path="${info.path || '<root>'}" `
      + `watchCount=${info.watchCount} mode=${this.watchMode} maxWatches=${this.maxWatches}`,
    );
  }

  logWatchMode({ directoryCount, watchCount }) {
    console.info(
      `[filesystem-sync] file watcher started mode=${this.watchMode} `
      + `directoryCount=${directoryCount} watchCount=${watchCount} maxWatches=${this.maxWatches}`,
    );
  }

  initializeFromSnapshot({ snapshot = null } = {}) {
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? null;
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
    return readWorkspacePathSnapshotFromAdapter(this.workspaceStateAdapter, pathValue);
  }

  async buildIncrementalResult() {
    return deriveIncrementalWorkspaceState(this.workspaceStateAdapter, {
      forceFullScan: this.forceFullScan,
      maxPendingPaths: MAX_INCREMENTAL_PENDING_PATHS,
      pendingPaths: Array.from(this.pendingEventTypesByPath.keys()),
      previousState: this.lastState,
      readPathSnapshot: (pathValue) => this.readWorkspacePathSnapshot(pathValue),
    });
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
    let workspaceChange = incrementalResult?.workspaceChange ?? detectWorkspaceStateChange(this.lastState, nextState);
    this.lastState = nextState;

    let filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
    if (!filteredChange) {
      const authoritativeChange = detectWorkspaceStateChange(authoritativePreviousState, nextState);
      if (hasWorkspaceStatePaths(authoritativeChange)) {
        nextState = await this.vaultFileStore.scanWorkspaceState();
        workspaceChange = detectWorkspaceStateChange(authoritativePreviousState, nextState);
        this.lastState = nextState;
        filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
        effectiveMode = 'full-scan';
        effectiveFallbackReason = effectiveFallbackReason || 'authoritative-rebase';
      }
    }

    if (!filteredChange) {
      if (this.mutationCoordinator.isGloballySuppressed?.() || hasWorkspaceStatePaths(workspaceChange)) {
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
    if (this.watchRegistry) {
      this.watchRegistry.closeAll();
      this.watchRegistry = null;
    }
    this.appliedRoomDirs = new Set();
    this.appliedSubscribedDirs = new Set();
    await this.runningFlush;
  }
}
