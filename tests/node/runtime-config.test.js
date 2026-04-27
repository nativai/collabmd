import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFileRouteHash,
  getHashRoute,
  isCollabMdHashRoute,
  navigateToGitCommit,
  navigateToGitFileHistory,
  navigateToGitFilePreview,
  navigateToFile,
} from '../../src/client/infrastructure/runtime-config.js';

function createWindowStub(hash = '') {
  return {
    __COLLABMD_CONFIG__: {},
    location: {
      hash,
      host: 'localhost',
      origin: 'http://localhost',
      protocol: 'http:',
      search: '',
    },
  };
}

test('runtime-config parses file history and file preview routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#git-file-history=notes%2Ftoday.md');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    filePath: 'notes/today.md',
    type: 'git-file-history',
  });

  globalThis.window.location.hash = '#git-file-preview=docs%2Fold-name.md&current=docs%2Fguide.md&hash=abc1234';
  assert.deepEqual(getHashRoute(), {
    currentFilePath: 'docs/guide.md',
    filePath: 'docs/old-name.md',
    hash: 'abc1234',
    type: 'git-file-preview',
  });

  globalThis.window.location.hash = '#git-commit=abc1234&history=docs%2Fguide.md&path=docs%2Fold-name.md';
  assert.deepEqual(getHashRoute(), {
    hash: 'abc1234',
    historyFilePath: 'docs/guide.md',
    path: 'docs/old-name.md',
    type: 'git-commit',
  });
});

test('runtime-config builds file history and file preview hashes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub();

  t.after(() => {
    globalThis.window = previousWindow;
  });

  navigateToGitFileHistory({ filePath: 'notes/today.md' });
  assert.equal(globalThis.window.location.hash, 'git-file-history=notes%2Ftoday.md');

  navigateToGitFilePreview({
    hash: 'abc1234',
    path: 'docs/old-name.md',
    currentFilePath: 'docs/guide.md',
  });
  assert.equal(
    globalThis.window.location.hash,
    'git-file-preview=docs%2Fold-name.md&current=docs%2Fguide.md&hash=abc1234',
  );

  navigateToGitCommit({
    hash: 'abc1234',
    historyFilePath: 'docs/guide.md',
    path: 'docs/old-name.md',
  });
  assert.equal(
    globalThis.window.location.hash,
    'git-commit=abc1234&history=docs%2Fguide.md&path=docs%2Fold-name.md',
  );
});

test('runtime-config parses and builds drawio text fallback routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#file=diagrams%2Farchitecture.drawio&drawio=text');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    anchor: null,
    drawioMode: 'text',
    filePath: 'diagrams/architecture.drawio',
    type: 'file',
  });

  navigateToFile('diagrams/architecture.drawio', { drawioMode: 'text' });
  assert.equal(globalThis.window.location.hash, 'file=diagrams%2Farchitecture.drawio&drawio=text');
});

test('runtime-config parses and builds file anchor routes', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = createWindowStub('#file=MongoDB%2Fmigration-plan.md&anchor=approach-b-pros');

  t.after(() => {
    globalThis.window = previousWindow;
  });

  assert.deepEqual(getHashRoute(), {
    anchor: 'approach-b-pros',
    drawioMode: null,
    filePath: 'MongoDB/migration-plan.md',
    type: 'file',
  });

  assert.equal(
    createFileRouteHash('MongoDB/migration-plan.md', { anchor: 'approach-b-pros' }),
    'file=MongoDB%2Fmigration-plan.md&anchor=approach-b-pros',
  );

  navigateToFile('MongoDB/migration-plan.md', { anchor: 'approach-b-pros' });
  assert.equal(globalThis.window.location.hash, 'file=MongoDB%2Fmigration-plan.md&anchor=approach-b-pros');
});

test('runtime-config distinguishes app-owned hash routes from document fragments', () => {
  assert.equal(isCollabMdHashRoute('#file=README.md'), true);
  assert.equal(isCollabMdHashRoute('#git-diff=README.md'), true);
  assert.equal(isCollabMdHashRoute('#git-history=1'), true);
  assert.equal(isCollabMdHashRoute('#file'), false);
  assert.equal(isCollabMdHashRoute('#git-history'), false);
  assert.equal(isCollabMdHashRoute('#section-a'), false);
  assert.equal(isCollabMdHashRoute('#approach-b-pros'), false);
});
