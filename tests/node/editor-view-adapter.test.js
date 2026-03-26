import test from 'node:test';
import assert from 'node:assert/strict';

import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import { createLanguageExtension } from '../../src/client/infrastructure/editor-view-adapter.js';

function collectSyntaxNodeNames(state) {
  const names = [];
  syntaxTree(state).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

test('createLanguageExtension uses YAML syntax for base files', () => {
  const state = EditorState.create({
    doc: 'views:\n  - type: table\n',
    extensions: [createLanguageExtension('views/tasks.base')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('BlockMapping'));
  assert.ok(nodeNames.includes('BlockSequence'));
  assert.ok(!nodeNames.includes('Paragraph'));
});

test('createLanguageExtension keeps Markdown syntax for markdown files', () => {
  const state = EditorState.create({
    doc: 'views:\n  - type: table\n',
    extensions: [createLanguageExtension('README.md')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('Paragraph'));
  assert.ok(!nodeNames.includes('BlockMapping'));
});
