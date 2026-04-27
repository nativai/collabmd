import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDiagramExportBaseName,
  createDiagramExportFileNames,
} from '../../src/client/application/diagram-preview-export.js';

test('createDiagramExportBaseName uses the target file stem for embedded diagrams', () => {
  assert.equal(createDiagramExportBaseName({
    currentFilePath: 'notes/README.md',
    diagramKind: 'mermaid',
    targetPath: 'diagrams/sample-mermaid.mmd',
  }), 'sample-mermaid');
});

test('createDiagramExportBaseName uses the standalone file stem for standalone previews', () => {
  assert.equal(createDiagramExportBaseName({
    currentFilePath: 'diagrams/sequence.plantuml',
    diagramKind: 'plantuml',
  }), 'sequence');
});

test('createDiagramExportBaseName uses the markdown file stem and source line for fenced diagrams', () => {
  assert.equal(createDiagramExportBaseName({
    currentFilePath: 'notes/README.md',
    diagramKind: 'plantuml',
    sourceLine: '14',
  }), 'README-plantuml-L14');
});

test('createDiagramExportFileNames returns stable SVG and PNG names', () => {
  assert.deepEqual(createDiagramExportFileNames({
    currentFilePath: 'notes/daily.md',
    diagramKind: 'mermaid',
    sourceLine: '22',
  }), {
    baseName: 'daily-mermaid-L22',
    pngFileName: 'daily-mermaid-L22.png',
    svgFileName: 'daily-mermaid-L22.svg',
  });
});
