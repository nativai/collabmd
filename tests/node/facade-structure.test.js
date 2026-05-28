import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

async function readSource(repoPath) {
  return readFile(resolve(repoRoot, repoPath), 'utf8');
}

function extractSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

test('EditorSession stays a thin orchestration facade', async () => {
  const source = await readSource('src/client/infrastructure/editor-session.js');
  const specifiers = extractSpecifiers(source);

  assert.deepEqual(specifiers.sort(), [
    './comment-thread-store.js',
    './editor-collaboration-client.js',
    './editor-view-adapter.js',
    'yjs',
  ]);
});

test('GitService stays a thin facade over internal git modules', async () => {
  const source = await readSource('src/server/infrastructure/git/git-service.js');
  const specifiers = extractSpecifiers(source);

  assert.equal(specifiers.some((specifier) => specifier.startsWith('node:')), false);
  assert.equal(specifiers.some((specifier) => specifier === 'yjs'), false);
  assert.equal(specifiers.includes('./command-runner.js'), true);
  assert.equal(specifiers.includes('./diff-service.js'), true);
  assert.equal(specifiers.includes('./status-service.js'), true);
});

test('VaultFileStore delegates path and sidecar concerns to dedicated helpers', async () => {
  const source = await readSource('src/server/infrastructure/persistence/vault-file-store.js');
  const specifiers = extractSpecifiers(source);

  assert.equal(specifiers.includes('./path-utils.js'), true);
  assert.equal(specifiers.includes('./sidecar-store.js'), true);
  assert.equal(specifiers.includes('./vault-content-adapter.js'), true);
});

test('CollabMdAppShell remains the composition root', async () => {
  const source = await readSource('src/client/bootstrap/collabmd-app-shell.js');
  const specifiers = extractSpecifiers(source);
  const featureForwarders = source.match(/^ {2}[a-zA-Z0-9_]+\(\.\.\.args\) \{ return this\.features\./gm) ?? [];

  assert.equal(specifiers.some((specifier) => specifier === 'yjs'), false);
  assert.equal(specifiers.some((specifier) => specifier === 'ws'), false);
  assert.equal(specifiers.includes('../application/workspace-coordinator.js'), true);
  assert.equal(specifiers.includes('../presentation/file-explorer-controller.js'), true);
  assert.equal(specifiers.includes('./app-shell-feature-surface.js'), true);
  assert.equal(specifiers.some((specifier) => specifier.includes('/app-shell/') || specifier.includes('lazy-controller-feature')), false);
  assert.equal(source.includes('Object.assign('), false);
  assert.equal(source.includes('installAppShellFeatures('), false);
  assert.equal(featureForwarders.length, 6);
  assert.equal(source.includes('handleHashChange(...args)'), true);
  assert.equal(source.includes('handleDocumentKeydown(...args)'), true);
  assert.equal(source.includes('handleDocumentPointerDown(...args)'), true);
  assert.equal(source.includes('handleFileSelection(...args)'), true);
  assert.equal(source.includes('navigatePreviewHeading(...args)'), true);
});

test('App Shell feature surface delegates feature methods against shell state', async () => {
  const { createAppShellFeatureSurface } = await import('../../src/client/bootstrap/app-shell-feature-surface.js');
  const appShell = {
    value: 0,
    shellMethod() {
      return `value:${this.value}`;
    },
  };

  const surface = createAppShellFeatureSurface(appShell, {
    alpha: {
      increment(delta = 1) {
        this.value += delta;
        return this.readValue();
      },
      readValue() {
        return this.value;
      },
    },
    beta: {
      readShellMethod() {
        return this.shellMethod();
      },
    },
  });

  assert.equal(surface.increment(3), 3);
  assert.equal(appShell.value, 3);
  assert.equal(surface.readShellMethod(), 'value:3');
  assert.equal('shellMethod' in surface, true);
});
