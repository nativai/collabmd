import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileEmbedEntries } from '../../src/client/presentation/excalidraw-embed-reconciler.js';

test('reconcileEmbedEntries preserves existing iframe entries for unchanged keys', () => {
  const cachedEntry = {
    iframe: { id: 'iframe-1' },
    key: 'system-architecture.excalidraw#0',
    wrapper: { id: 'wrapper-1' },
  };
  const currentEntries = new Map([[cachedEntry.key, cachedEntry]]);

  const { nextEntries, removedEntries } = reconcileEmbedEntries(currentEntries, [
    {
      filePath: 'system-architecture.excalidraw',
      key: 'system-architecture.excalidraw#0',
      label: 'System Architecture',
      placeholder: { id: 'placeholder-1' },
    },
  ]);

  assert.equal(removedEntries.length, 0);
  assert.equal(nextEntries.get(cachedEntry.key), cachedEntry);
  assert.equal(nextEntries.get(cachedEntry.key).iframe.id, 'iframe-1');
});

test('reconcileEmbedEntries reports removed embeds and preserves duplicate occurrence keys', () => {
  const firstDuplicate = {
    iframe: { id: 'iframe-1' },
    key: 'diagram.excalidraw#0',
    wrapper: { id: 'wrapper-1' },
  };
  const secondDuplicate = {
    iframe: { id: 'iframe-2' },
    key: 'diagram.excalidraw#1',
    wrapper: { id: 'wrapper-2' },
  };
  const currentEntries = new Map([
    [firstDuplicate.key, firstDuplicate],
    [secondDuplicate.key, secondDuplicate],
    ['removed.excalidraw#0', { key: 'removed.excalidraw#0', wrapper: { id: 'removed-wrapper' } }],
  ]);

  const { nextEntries, removedEntries } = reconcileEmbedEntries(currentEntries, [
    {
      filePath: 'diagram.excalidraw',
      key: 'diagram.excalidraw#1',
      label: 'Diagram Second',
      placeholder: { id: 'placeholder-2' },
    },
    {
      filePath: 'diagram.excalidraw',
      key: 'diagram.excalidraw#0',
      label: 'Diagram First',
      placeholder: { id: 'placeholder-1' },
    },
  ]);

  assert.equal(nextEntries.get('diagram.excalidraw#0'), firstDuplicate);
  assert.equal(nextEntries.get('diagram.excalidraw#1'), secondDuplicate);
  assert.deepEqual(removedEntries.map((entry) => entry.key), ['removed.excalidraw#0']);
});
