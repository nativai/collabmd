import {
  isBaseFilePath,
  isDrawioFilePath,
  isExcalidrawFilePath,
  isMarkdownFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';

export class EditableVaultContentKind {
  constructor({
    invalidPathError,
    kind,
    matches,
  }) {
    this.invalidPathError = invalidPathError;
    this.kind = kind;
    this.matches = matches;
  }

  supports(filePath) {
    return this.matches(filePath);
  }
}

const adapters = [
  new EditableVaultContentKind({
    invalidPathError: 'Invalid file path',
    kind: 'markdown',
    matches: isMarkdownFilePath,
  }),
  new EditableVaultContentKind({
    invalidPathError: 'Invalid file path — must end in .base',
    kind: 'base',
    matches: isBaseFilePath,
  }),
  new EditableVaultContentKind({
    invalidPathError: 'Invalid file path — must end in .excalidraw',
    kind: 'excalidraw',
    matches: isExcalidrawFilePath,
  }),
  new EditableVaultContentKind({
    invalidPathError: 'Invalid file path — must end in .drawio',
    kind: 'drawio',
    matches: isDrawioFilePath,
  }),
  new EditableVaultContentKind({
    invalidPathError: 'Invalid file path — must end in .mmd or .mermaid',
    kind: 'mermaid',
    matches: isMermaidFilePath,
  }),
  new EditableVaultContentKind({
    invalidPathError: 'Invalid file path — must end in .puml or .plantuml',
    kind: 'plantuml',
    matches: isPlantUmlFilePath,
  }),
];

export function getEditableVaultContentKind(filePath) {
  return adapters.find((adapter) => adapter.supports(filePath)) ?? null;
}
