import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';
import {
  FileSystemSyncService,
  WatchRegistry,
} from '../../src/server/infrastructure/workspace/file-system-sync-service.js';

// A mutation coordinator stub sufficient for start()/close(): start() reads
// `.workspaceState` only when no snapshot is passed (we always pass one), and no
// flush is triggered in these tests unless we deliberately let one run.
function createMutationCoordinatorStub() {
  return {
    workspaceState: null,
    filterManagedWorkspaceChange: (change) => change,
    isGloballySuppressed: () => false,
    syncWorkspaceEntries: () => {},
    replaceWorkspaceState: () => {},
    apply: async () => {},
  };
}

async function createVault(subdirectories = []) {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-watch-registry-'));
  for (const relativeDir of subdirectories) {
    await mkdir(join(vaultDir, relativeDir), { recursive: true });
  }
  await writeFile(join(vaultDir, 'README.md'), '# Readme\n', 'utf8');

  return {
    cleanup: () => rm(vaultDir, { force: true, recursive: true }),
    store: new VaultFileStore({ vaultDir }),
    vaultDir,
  };
}

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

test('small vault (directory count <= cap) keeps the recursive whole-vault watch', async (t) => {
  const { cleanup, store } = await createVault(['docs', 'notes']);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 4096,
    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });

  assert.equal(service.watchMode, 'recursive');
  assert.ok(service.watchRegistry.recursiveWatcher, 'a recursive watcher should be held');
  assert.equal(service.watchRegistry.size, 1);
});

test('large vault (directory count > cap) switches to lazy mode: root watched, cap respected', async (t) => {
  const { cleanup, store } = await createVault(['a', 'b', 'c', 'd', 'e']);
  t.after(cleanup);

  const maxWatches = 3;
  const service = new FileSystemSyncService({
    maxWatches,
    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });

  assert.equal(service.watchMode, 'lazy');
  assert.ok(service.watchRegistry.recursiveWatcher === null, 'no recursive watcher in lazy mode');
  // With no open files or expanded dirs, lazy mode holds only the vault root — the
  // footprint is a function of usage, not vault size (no proactive top-N sweep).
  assert.equal(service.watchRegistry.size, 1, 'only the vault root is watched at rest');
  assert.ok(service.watchRegistry.watchers.has(''), 'the vault root is always watched in lazy mode');
});

test('lazy mode always watches the directory of every already-open file', async (t) => {
  const { cleanup, store } = await createVault(['docs/deep', 'unrelated1', 'unrelated2', 'unrelated3']);
  t.after(cleanup);

  const roomRegistry = {
    getRooms: () => [
      ['docs/deep/guide.md', {}],
      ['__lobby__', {}], // transient room — must be ignored (not a vault file path)
    ],
  };

  const service = new FileSystemSyncService({
    maxWatches: 2, // only room enough for root + the open file's directory
    mutationCoordinator: createMutationCoordinatorStub(),
    roomRegistry,
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });

  assert.equal(service.watchMode, 'lazy');
  assert.ok(service.watchRegistry.watchers.has('docs/deep'), 'open-file directory should be watched even under a tight cap');
  assert.ok(service.watchRegistry.watchers.has(''), 'the vault root should be watched');
});

test('lazy mode never watches ignored directories a client subscribes (.git / node_modules)', async (t) => {
  const { cleanup, store } = await createVault(['.git/objects', 'node_modules/pkg', 'alpha', 'beta', 'gamma', 'delta']);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 3,
    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });
  assert.equal(service.watchMode, 'lazy');

  // A client publishes a mix of real and VCS/tooling directories as "expanded".
  service.updateWatchSubscriptions({ dirs: ['.git/objects', 'node_modules/pkg', 'alpha'], activeFiles: [] });

  const watchedDirs = Array.from(service.watchRegistry.watchers.keys());
  assert.ok(watchedDirs.includes('alpha'), 'a real expanded directory should be watched');
  for (const dir of watchedDirs) {
    assert.ok(!dir.startsWith('.git'), `must not watch .git: ${dir}`);
    assert.ok(!dir.startsWith('node_modules'), `must not watch node_modules: ${dir}`);
  }
});

test('a watch error degrades gracefully instead of crashing, logging exactly once', async (t) => {
  const { cleanup, vaultDir } = await createVault(['docs']);
  t.after(cleanup);

  let degradeCount = 0;
  const registry = new WatchRegistry({
    vaultDir,
    maxWatches: 10,
    onEvent: () => {},
    onDegrade: () => { degradeCount += 1; },
  });
  t.after(() => registry.closeAll());

  registry.watchRecursive();
  const watcher = registry.recursiveWatcher;
  assert.ok(watcher, 'expected a recursive watcher');

  // Simulate the ENOSPC that the kernel raises when max_user_watches is exhausted.
  // With an 'error' listener attached this must NOT re-throw (the crash we fix).
  const enospc = Object.assign(new Error('ENOSPC: no space left, watch'), { code: 'ENOSPC' });
  assert.doesNotThrow(() => watcher.emit('error', enospc));
  // Repeated errors from the recursive walker must be idempotent — logged once.
  assert.doesNotThrow(() => watcher.emit('error', enospc));

  assert.equal(degradeCount, 1, 'degradation should be reported exactly once');
  assert.equal(registry.degraded, true);
});

test('cap = 0 fully degrades (zero watches) without crashing', async (t) => {
  const { cleanup, store } = await createVault(['a', 'b', 'c']);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 0,
    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await assert.doesNotReject(() => service.start({ snapshot }));

  assert.equal(service.watchMode, 'lazy');
  assert.equal(service.watchRegistry.size, 0, 'no watches should be placed at cap 0');
});

test('per-directory watch events are re-rooted to vault-relative paths (path contract)', async (t) => {
  const { cleanup, store, vaultDir } = await createVault(['docs', 'x1', 'x2', 'x3']);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 2, // lazy: root + docs (the open-file dir)
    mutationCoordinator: createMutationCoordinatorStub(),
    roomRegistry: { getRooms: () => [['docs/seed.md', {}]] },
    vaultFileStore: store,
  });
  t.after(() => service.close());

  await writeFile(join(vaultDir, 'docs', 'seed.md'), '# Seed\n', 'utf8');
  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });

  assert.ok(service.watchRegistry.watchers.has('docs'), 'docs must be watched for this test to be meaningful');

  // Capture what the downstream handler receives — it must be the vault-relative
  // path 'docs/note.md', not the dir-relative 'note.md' fs.watch reports.
  const seenPaths = [];
  service.handleWatchEvent = (eventType, filename) => { seenPaths.push(filename); };

  await writeFile(join(vaultDir, 'docs', 'note.md'), '# Note\n', 'utf8');

  const observed = await waitFor(() => seenPaths.some((p) => p === 'docs/note.md'));
  assert.ok(observed, `expected a 'docs/note.md' event, saw: ${JSON.stringify(seenPaths)}`);
});

// ---------------------------------------------------------------------------
// Phase 2 — ref-counted, demand-driven watching
// ---------------------------------------------------------------------------

test('retain/release ref-counts: a directory survives until the last reference drops', async (t) => {
  const { cleanup, vaultDir } = await createVault(['shared']);
  t.after(cleanup);

  const registry = new WatchRegistry({
    vaultDir,
    maxWatches: 10,
    onEvent: () => {},
    onDegrade: () => {},
  });
  t.after(() => registry.closeAll());

  // Two independent sources (e.g. an open room AND an expanded tree node) reference
  // the same directory — one shared watcher, ref-count 2.
  registry.retain('shared');
  registry.retain('shared');
  assert.equal(registry.refCount('shared'), 2);
  assert.equal(registry.watchers.size, 1, 'one shared watcher, not two');

  // First release: still wanted by the other source, watch stays.
  registry.release('shared');
  assert.equal(registry.refCount('shared'), 1);
  assert.ok(registry.watchers.has('shared'), 'watch survives while a reference remains');

  // Last release: dropped.
  registry.release('shared');
  assert.equal(registry.refCount('shared'), 0);
  assert.ok(!registry.watchers.has('shared'), 'watch dropped when no longer referenced');
});

test('retain enforces the cap and promotes a wanted directory when a slot frees', async (t) => {
  const { cleanup, vaultDir } = await createVault(['a', 'b', 'c']);
  t.after(cleanup);

  const registry = new WatchRegistry({
    vaultDir,
    maxWatches: 2,
    onEvent: () => {},
    onDegrade: () => {},
  });
  t.after(() => registry.closeAll());

  registry.retain('a');
  registry.retain('b');
  registry.retain('c'); // over cap — wanted but unplaced
  assert.equal(registry.size, 2, 'never exceeds the cap');
  assert.ok(!registry.watchers.has('c'), 'the over-cap directory holds no watcher');
  assert.equal(registry.refCount('c'), 1, 'but it is still recorded as wanted');

  // Freeing a slot promotes the wanted-but-unplaced directory.
  registry.release('a');
  assert.equal(registry.size, 2, 'the freed slot is reused, still within cap');
  assert.ok(registry.watchers.has('c'), 'the wanted directory is promoted into the freed slot');
});

test('on file-open a watch is registered for its directory; on close it is released', async (t) => {
  const { cleanup, store } = await createVault(['a', 'b', 'c', 'deep/nested']);
  t.after(cleanup);

  // A mutable room set the service reads as ground truth on each lifecycle notification.
  let rooms = [];
  const roomRegistry = { getRooms: () => rooms };

  const service = new FileSystemSyncService({
    maxWatches: 3, // < directory count, so the vault runs in lazy mode
    mutationCoordinator: createMutationCoordinatorStub(),
    roomRegistry,
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });
  assert.equal(service.watchMode, 'lazy');
  assert.ok(!service.watchRegistry.watchers.has('deep/nested'), 'deep dir unwatched before its file is opened');

  // A file is opened LATER in a deep directory (the Phase 1 gap this closes).
  rooms = [['deep/nested/note.md', {}]];
  service.onRoomOpened();
  assert.ok(service.watchRegistry.watchers.has('deep/nested'), 'opening a deep file registers a watch on its directory');

  // The file is closed (last client left) — its directory watch is released.
  rooms = [];
  service.onRoomClosed();
  assert.ok(!service.watchRegistry.watchers.has('deep/nested'), 'closing the file releases the watch');
});

test('on tree-expand a watch is added; on collapse it is released (and reconcile is requested)', async (t) => {
  const { cleanup, store } = await createVault(['alpha/one', 'beta/two', 'gamma']);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 3, // < directory count, so the vault runs in lazy mode
    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });
  assert.equal(service.watchMode, 'lazy');

  // Client expands two directories.
  service.updateWatchSubscriptions({ dirs: ['alpha', 'beta'], activeFiles: [] });
  assert.ok(service.watchRegistry.watchers.has('alpha'), 'expanded directory alpha is watched');
  assert.ok(service.watchRegistry.watchers.has('beta'), 'expanded directory beta is watched');
  // On-expand reconcile: newly-subscribed dirs are queued for a re-read so changes
  // that happened while they were unwatched are picked up (correct even at 0 watches).
  assert.ok(service.pendingEventTypesByPath.has('alpha'), 'a reconcile is requested for a newly-expanded directory');

  // Client collapses beta (only alpha remains expanded).
  service.updateWatchSubscriptions({ dirs: ['alpha'], activeFiles: [] });
  assert.ok(service.watchRegistry.watchers.has('alpha'), 'still-expanded directory stays watched');
  assert.ok(!service.watchRegistry.watchers.has('beta'), 'collapsed directory is released');
});

test('an active file is queued for reconcile on subscription update (on-focus reconcile)', async (t) => {
  const { cleanup, store, vaultDir } = await createVault(['docs/deep']);
  t.after(cleanup);

  await writeFile(join(vaultDir, 'docs', 'deep', 'open.md'), '# Open\n', 'utf8');

  const service = new FileSystemSyncService({
    maxWatches: 1, // < directory count, so the vault runs in lazy mode

    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });

  // Focus re-asserts the subscription carrying the open file; it must be re-read so
  // its content reconciles even when its directory watch is absent.
  service.updateWatchSubscriptions({ dirs: [], activeFiles: ['docs/deep/open.md'] });
  assert.ok(
    service.pendingEventTypesByPath.has('docs/deep/open.md'),
    'the active file is queued for a reconcile read',
  );
});

test('demand-driven watching stays independent of vault size and within the cap', async (t) => {
  const manyDirs = Array.from({ length: 60 }, (_, index) => `d${index}`);
  const { cleanup, store } = await createVault(manyDirs);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 16,
    mutationCoordinator: createMutationCoordinatorStub(),
    vaultFileStore: store,
  });
  t.after(() => service.close());

  const snapshot = await store.scanWorkspaceState();
  await service.start({ snapshot });
  assert.equal(service.watchMode, 'lazy');
  // 60 directories, but at rest we hold exactly one watch (root) — footprint tracks
  // usage, not vault size.
  assert.equal(service.watchRegistry.size, 1);

  // Even a client that expands far more directories than the cap can never exceed it.
  service.updateWatchSubscriptions({ dirs: manyDirs, activeFiles: [] });
  assert.ok(service.watchRegistry.size <= 16, `held ${service.watchRegistry.size} watches, cap 16`);
});
