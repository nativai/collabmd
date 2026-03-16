import {
  isMarkdownFilePath,
  supportsBacklinksForFilePath,
} from '../../domain/file-kind.js';

export class WorkspaceChromeController {
  constructor({
    beginDocumentLoad,
    getDisplayName,
    loadBacklinks,
    onBeforeFileOpen,
    onFileOpenError,
    onFileOpenReady,
    onRenderExcalidrawPreview,
    onRenderImagePreview,
    onSyncWrapToggle,
    onUpdateActiveFile,
    onUpdateCurrentFile,
    onUpdateLobbyCurrentFile,
    onUpdateVisibleChrome,
    onViewModeReset,
    renderPresence,
    showEditorLoading,
    stateStore,
  }) {
    this.beginDocumentLoad = beginDocumentLoad;
    this.getDisplayName = getDisplayName;
    this.loadBacklinks = loadBacklinks;
    this.onBeforeFileOpen = onBeforeFileOpen;
    this.onFileOpenError = onFileOpenError;
    this.onFileOpenReady = onFileOpenReady;
    this.onRenderExcalidrawPreview = onRenderExcalidrawPreview;
    this.onRenderImagePreview = onRenderImagePreview;
    this.onSyncWrapToggle = onSyncWrapToggle;
    this.onUpdateActiveFile = onUpdateActiveFile;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.onUpdateVisibleChrome = onUpdateVisibleChrome;
    this.onViewModeReset = onViewModeReset;
    this.renderPresence = renderPresence;
    this.showEditorLoading = showEditorLoading;
    this.stateStore = stateStore;
  }

  prepareForFileOpen(filePath, { resetConnectionState = true } = {}) {
    this.onViewModeReset();
    this.onBeforeFileOpen();
    this.stateStore.set('connectionHelpShown', false);
    if (resetConnectionState) {
      this.stateStore.set('connectionState', { status: 'connecting', unreachable: false });
    }
    this.stateStore.set('currentFilePath', filePath);
    this.onUpdateCurrentFile(filePath);
    this.onUpdateLobbyCurrentFile(filePath);
    this.onUpdateActiveFile(filePath);
    this.onUpdateVisibleChrome(filePath, {
      displayName: this.getDisplayName(filePath),
      isMarkdown: isMarkdownFilePath(filePath),
    });
    this.showEditorLoading();
    this.beginDocumentLoad();
    this.renderPresence();

    return {
      supportsBacklinks: supportsBacklinksForFilePath(filePath),
    };
  }

  markFileOpenReady(session) {
    this.onFileOpenReady(session);
  }

  finalizeFileOpen({
    filePath,
    isExcalidraw = false,
    isImage = false,
    session = null,
    supportsBacklinks,
  }) {
    if (isExcalidraw) {
      this.onRenderExcalidrawPreview(filePath);
    }
    if (isImage) {
      this.onRenderImagePreview(filePath);
    }
    this.onSyncWrapToggle();
    if (supportsBacklinks && session) {
      this.loadBacklinks(filePath);
    }
  }

  handleFileOpenError() {
    this.onFileOpenError();
  }
}
