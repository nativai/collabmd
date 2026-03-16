import test from 'node:test';
import assert from 'node:assert/strict';

import { FileTreeState } from '../../src/client/presentation/file-tree-state.js';

test('FileTreeState flattens tree nodes and filters search matches', () => {
  const state = new FileTreeState();

  state.setTree([
    {
      children: [
        { name: 'README.md', path: 'docs/README.md', type: 'file' },
        { name: 'diagram.puml', path: 'docs/diagram.puml', type: 'plantuml' },
        { name: 'diagram.png', path: 'docs/diagram.png', type: 'image' },
      ],
      name: 'docs',
      path: 'docs',
      type: 'directory',
    },
    { name: 'sketch.excalidraw', path: 'sketch.excalidraw', type: 'excalidraw' },
  ]);

  state.setSearchQuery('diag');

  assert.deepEqual(state.flatFiles, [
    'docs/README.md',
    'docs/diagram.puml',
    'docs/diagram.png',
    'sketch.excalidraw',
  ]);
  assert.deepEqual(state.getSearchMatches(), ['docs/diagram.puml', 'docs/diagram.png']);
});

test('FileTreeState expands parent directories for active files', () => {
  const state = new FileTreeState();

  state.setActiveFile('notes/daily/today.md');

  assert.equal(state.activeFilePath, 'notes/daily/today.md');
  assert.deepEqual([...state.expandedDirs], ['notes', 'notes/daily']);
});

test('FileTreeState toggles directories and ignores invalid expansion paths', () => {
  const state = new FileTreeState();

  assert.equal(state.toggleDirectory('notes'), true);
  assert.equal(state.expandedDirs.has('notes'), true);
  assert.equal(state.toggleDirectory('notes'), false);
  assert.equal(state.expandedDirs.has('notes'), false);

  state.expandDirectoryPath('../escape');
  assert.deepEqual([...state.expandedDirs], []);
});
