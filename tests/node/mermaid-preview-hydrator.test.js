import test from 'node:test';
import assert from 'node:assert/strict';

import { MermaidPreviewHydrator } from '../../src/client/application/mermaid-preview-hydrator.js';

test('MermaidPreviewHydrator loads embedded Mermaid file sources through the injected loader', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      classList: {
        add() {},
        remove() {},
      },
      querySelector() {
        return null;
      },
    },
    documentElement: {
      dataset: {},
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  const loaderCalls = [];
  const hydrator = new MermaidPreviewHydrator({
    previewElement: null,
  }, {
    loadFileSource: async (filePath) => {
      loaderCalls.push(filePath);
      return 'graph TD\nA-->B';
    },
  });

  const [first, second] = await Promise.all([
    hydrator.fetchSource('docs/flow.mmd'),
    hydrator.fetchSource('docs/flow.mmd'),
  ]);

  assert.equal(first, 'graph TD\nA-->B');
  assert.equal(second, first);
  assert.deepEqual(loaderCalls, ['docs/flow.mmd']);
});

test('MermaidPreviewHydrator configures embedded renders with SVG text labels', (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      classList: {
        add() {},
        remove() {},
      },
      querySelector() {
        return null;
      },
    },
    documentElement: {
      dataset: {},
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  let initializedConfig = null;
  const hydrator = new MermaidPreviewHydrator({
    previewElement: null,
  });
  hydrator.configureMermaid({
    initialize(config) {
      initializedConfig = config;
    },
  });

  assert.equal(initializedConfig.htmlLabels, false);
  assert.equal(initializedConfig.flowchart.htmlLabels, false);
});
