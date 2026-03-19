import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceSyncClient } from '../../src/client/infrastructure/workspace-sync-client.js';

function snapshotTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}

test('WorkspaceSyncClient incrementally applies workspace entry add, rename, and delete changes', () => {
  const treeSnapshots = [];
  const client = new WorkspaceSyncClient({
    onTreeChange(tree) {
      treeSnapshots.push(snapshotTree(tree));
    },
  });

  client._didInitialSync = true;
  client.entries.observe(client.handleEntriesChange);

  client.ydoc.transact(() => {
    client.entries.set('docs', {
      fileKind: null,
      name: 'docs',
      nodeType: 'directory',
      parentPath: '',
      path: 'docs',
      type: 'directory',
    });
    client.entries.set('docs/guide.md', {
      fileKind: 'file',
      name: 'guide.md',
      nodeType: 'file',
      parentPath: 'docs',
      path: 'docs/guide.md',
      type: 'file',
    });
  });

  assert.deepEqual(treeSnapshots.at(-1), [{
    children: [{
      name: 'guide.md',
      path: 'docs/guide.md',
      type: 'file',
    }],
    name: 'docs',
    path: 'docs',
    type: 'directory',
  }]);

  client.ydoc.transact(() => {
    client.entries.delete('docs/guide.md');
    client.entries.set('docs/readme.md', {
      fileKind: 'file',
      name: 'readme.md',
      nodeType: 'file',
      parentPath: 'docs',
      path: 'docs/readme.md',
      type: 'file',
    });
  });

  assert.deepEqual(treeSnapshots.at(-1), [{
    children: [{
      name: 'readme.md',
      path: 'docs/readme.md',
      type: 'file',
    }],
    name: 'docs',
    path: 'docs',
    type: 'directory',
  }]);

  client.ydoc.transact(() => {
    client.entries.delete('docs/readme.md');
    client.entries.delete('docs');
  });

  assert.deepEqual(treeSnapshots.at(-1), []);
  client.entries.unobserve(client.handleEntriesChange);
  client.ydoc.destroy();
});
