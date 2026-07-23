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

test('large vault (directory count > cap) switches to bounded mode and never exceeds the cap', async (t) => {
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

  assert.equal(service.watchMode, 'bounded');
  assert.ok(service.watchRegistry.recursiveWatcher === null, 'no recursive watcher in bounded mode');
  assert.ok(service.watchRegistry.size <= maxWatches, `held ${service.watchRegistry.size} watches, cap ${maxWatches}`);
  assert.ok(service.watchRegistry.watchers.has(''), 'the vault root is always watched in bounded mode');
});

test('bounded mode always watches the directory of every open file', async (t) => {
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

  assert.equal(service.watchMode, 'bounded');
  assert.ok(service.watchRegistry.watchers.has('docs/deep'), 'open-file directory should be watched even under a tight cap');
  assert.ok(service.watchRegistry.watchers.has(''), 'the vault root should be watched');
});

test('bounded mode honours vault ignore rules (never watches .git / node_modules)', async (t) => {
  // 4 real directories with cap 3 forces bounded mode AND a non-empty sweep, so the
  // ignore assertion is exercised against actual per-directory watchers (not vacuous).
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

  assert.equal(service.watchMode, 'bounded');
  const watchedDirs = Array.from(service.watchRegistry.watchers.keys());
  // Non-root watchers must exist (proves the sweep ran) and none may be ignored.
  assert.ok(watchedDirs.some((dir) => dir !== ''), 'the sweep should have watched at least one real directory');
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

  assert.equal(service.watchMode, 'bounded');
  assert.equal(service.watchRegistry.size, 0, 'no watches should be placed at cap 0');
});

test('per-directory watch events are re-rooted to vault-relative paths (path contract)', async (t) => {
  const { cleanup, store, vaultDir } = await createVault(['docs', 'x1', 'x2', 'x3']);
  t.after(cleanup);

  const service = new FileSystemSyncService({
    maxWatches: 2, // bounded: root + docs (the open-file dir)
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
