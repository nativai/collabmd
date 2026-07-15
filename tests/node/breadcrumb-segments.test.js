import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBreadcrumbSegments } from '../../src/client/domain/breadcrumb-segments.js';

test('derives cumulative segments for a deep path', () => {
  assert.deepEqual(
    deriveBreadcrumbSegments('Operating System/Projects/collabmd/PROJECT.md'),
    [
      { name: 'Operating System', path: 'Operating System', isLeaf: false },
      { name: 'Projects', path: 'Operating System/Projects', isLeaf: false },
      { name: 'collabmd', path: 'Operating System/Projects/collabmd', isLeaf: false },
      { name: 'PROJECT.md', path: 'Operating System/Projects/collabmd/PROJECT.md', isLeaf: true },
    ],
  );
});

test('a top-level file yields a single leaf segment (no ancestors)', () => {
  assert.deepEqual(
    deriveBreadcrumbSegments('README.md'),
    [{ name: 'README.md', path: 'README.md', isLeaf: true }],
  );
});

test('preserves spaces and special characters in folder names', () => {
  const segments = deriveBreadcrumbSegments('Operating System/Skills & Roles/notes.md');
  assert.deepEqual(segments.map((segment) => segment.name), [
    'Operating System',
    'Skills & Roles',
    'notes.md',
  ]);
  assert.equal(segments[1].path, 'Operating System/Skills & Roles');
});

test('works unchanged for non-.md leaf files', () => {
  const segments = deriveBreadcrumbSegments('diagrams/architecture.excalidraw');
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[1], {
    name: 'architecture.excalidraw',
    path: 'diagrams/architecture.excalidraw',
    isLeaf: true,
  });
});

test('empty / nullish input yields no segments', () => {
  assert.deepEqual(deriveBreadcrumbSegments(''), []);
  assert.deepEqual(deriveBreadcrumbSegments(null), []);
  assert.deepEqual(deriveBreadcrumbSegments(undefined), []);
  assert.deepEqual(deriveBreadcrumbSegments('   '), []);
});

test('normalizes trailing/leading slashes and backslashes', () => {
  assert.deepEqual(
    deriveBreadcrumbSegments('/docs/guide/'),
    [
      { name: 'docs', path: 'docs', isLeaf: false },
      { name: 'guide', path: 'docs/guide', isLeaf: true },
    ],
  );
  assert.deepEqual(
    deriveBreadcrumbSegments('docs\\guide\\intro.md').map((segment) => segment.path),
    ['docs', 'docs/guide', 'docs/guide/intro.md'],
  );
});

test('path traversal segments collapse to empty (rejected by normalization)', () => {
  assert.deepEqual(deriveBreadcrumbSegments('docs/../secrets.md'), []);
});
