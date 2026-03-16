import test from 'node:test';
import assert from 'node:assert/strict';

import { handleImagePasteEvent } from '../../src/client/infrastructure/editor-paste-utils.js';

test('handleImagePasteEvent intercepts pasted image files and forwards them to the upload callback', async () => {
  const calls = [];
  const pastedFile = {
    name: 'pasted-diagram.svg',
    type: 'image/svg+xml',
  };
  const event = {
    clipboardData: {
      items: [{
        getAsFile() {
          return pastedFile;
        },
        kind: 'file',
        type: 'image/svg+xml',
      }],
    },
    preventDefault() {
      calls.push('prevent-default');
    },
  };

  const handled = handleImagePasteEvent(event, async (file) => {
    calls.push(file);
  });

  await Promise.resolve();

  assert.equal(handled, true);
  assert.deepEqual(calls, ['prevent-default', pastedFile]);
});

test('handleImagePasteEvent supports clipboard image files exposed through clipboardData.files', async () => {
  const calls = [];
  const pastedFile = {
    name: 'pasted-diagram.png',
    type: 'image/png',
  };
  const event = {
    clipboardData: {
      files: [pastedFile],
      items: [],
    },
    preventDefault() {
      calls.push('prevent-default');
    },
  };

  const handled = handleImagePasteEvent(event, async (file) => {
    calls.push(file);
  });

  await Promise.resolve();

  assert.equal(handled, true);
  assert.deepEqual(calls, ['prevent-default', pastedFile]);
});

test('handleImagePasteEvent leaves non-image clipboard payloads alone', () => {
  const event = {
    clipboardData: {
      items: [{
        getAsFile() {
          return { type: 'text/plain' };
        },
        kind: 'file',
        type: 'text/plain',
      }],
    },
    preventDefault() {
      throw new Error('preventDefault should not be called');
    },
  };

  const handled = handleImagePasteEvent(event, () => {
    throw new Error('callback should not be invoked');
  });

  assert.equal(handled, false);
});
