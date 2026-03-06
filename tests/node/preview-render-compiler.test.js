import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';
import {
  LARGE_DOCUMENT_CHAR_THRESHOLD,
  analyzeMarkdownComplexity,
  isLargeDocumentStats,
} from '../../src/client/application/preview-render-profile.js';

test('compilePreviewDocument emits stable excalidraw placeholder keys and wiki-link anchors', () => {
  const markdown = [
    '# Preview',
    '',
    '![[system-architecture.excalidraw]]',
    '',
    '![[system-architecture.excalidraw|System Architecture]]',
    '',
    'See [[README]].',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
  ].join('\n');

  const { html, stats } = compilePreviewDocument({
    fileList: ['README.md'],
    markdownText: markdown,
  });

  assert.match(html, /data-embed-key="system-architecture\.excalidraw#0"/);
  assert.match(html, /data-embed-key="system-architecture\.excalidraw#1"/);
  assert.match(html, /class="wiki-link"/);
  assert.match(html, /data-mermaid-key="mermaid-[a-z0-9]+-0"/);
  assert.match(html, /data-mermaid-source-hash="[a-z0-9]+"/);
  assert.equal(stats.excalidrawEmbeds, 2);
  assert.equal(stats.mermaidBlocks, 1);
});

test('compilePreviewDocument keeps Mermaid keys stable across unrelated markdown edits', () => {
  const baseMarkdown = [
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
  ].join('\n');
  const editedMarkdown = [
    'Intro paragraph',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
  ].join('\n');

  const baseHtml = compilePreviewDocument({ markdownText: baseMarkdown }).html;
  const editedHtml = compilePreviewDocument({ markdownText: editedMarkdown }).html;
  const baseKey = baseHtml.match(/data-mermaid-key="([^"]+)"/)?.[1];
  const editedKey = editedHtml.match(/data-mermaid-key="([^"]+)"/)?.[1];

  assert.equal(baseKey, editedKey);
});

test('large-document classification triggers on any configured threshold', () => {
  const largeByChars = analyzeMarkdownComplexity('a'.repeat(LARGE_DOCUMENT_CHAR_THRESHOLD));
  assert.equal(isLargeDocumentStats(largeByChars), true);

  const largeByMermaid = analyzeMarkdownComplexity('```mermaid\ngraph TD\nA-->B\n```\n'.repeat(20));
  assert.equal(isLargeDocumentStats(largeByMermaid), true);

  const largeByExcalidraw = analyzeMarkdownComplexity('![[diagram.excalidraw]]\n'.repeat(8));
  assert.equal(isLargeDocumentStats(largeByExcalidraw), true);
});
