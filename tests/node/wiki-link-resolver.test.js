import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWikiTargetIndex,
  resolveWikiTargetPath,
  resolveWikiTargetWithIndex,
} from '../../src/domain/wiki-link-resolver.js';

test('resolveWikiTargetPath matches exact paths and bare note names', () => {
  const files = [
    'README.md',
    'notes/daily.md',
    'projects/collabmd.md',
  ];

  assert.equal(resolveWikiTargetPath('README', files), 'README.md');
  assert.equal(resolveWikiTargetPath('notes/daily', files), 'notes/daily.md');
  assert.equal(resolveWikiTargetPath('collabmd', files), 'projects/collabmd.md');
});

test('resolveWikiTargetPath prefers root-level exact matches over nested suffix matches', () => {
  const files = [
    'test-vault/showcase.md',
    'showcase.md',
  ];

  assert.equal(resolveWikiTargetPath('showcase', files), 'showcase.md');
  assert.equal(resolveWikiTargetPath('showcase.md', files), 'showcase.md');
});

test('resolveWikiTargetPath returns null for empty or missing targets', () => {
  const files = ['README.md'];

  assert.equal(resolveWikiTargetPath('', files), null);
  assert.equal(resolveWikiTargetPath('missing', files), null);
});

test('resolveWikiTargetWithIndex resolves without scanning file arrays', () => {
  const files = [
    'README.md',
    'notes/daily.md',
    'projects/collabmd.md',
  ];
  const index = createWikiTargetIndex(files);

  assert.equal(resolveWikiTargetWithIndex('README', index), 'README.md');
  assert.equal(resolveWikiTargetWithIndex('notes/daily', index), 'notes/daily.md');
  assert.equal(resolveWikiTargetWithIndex('collabmd', index), 'projects/collabmd.md');
});

test('resolveWikiTargetWithIndex prefers root-level exact matches over nested suffix matches', () => {
  const files = [
    'test-vault/showcase.md',
    'showcase.md',
  ];
  const index = createWikiTargetIndex(files);

  assert.equal(resolveWikiTargetWithIndex('showcase', index), 'showcase.md');
  assert.equal(resolveWikiTargetWithIndex('showcase.md', index), 'showcase.md');
});
