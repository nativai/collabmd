import { FileOpenLifecycle } from './file-open-lifecycle.js';
import { WorkspaceChromeController } from './workspace-chrome-controller.js';

export class WorkspaceCoordinator {
  constructor({
    attachEditorScroller,
    beginDocumentLoad,
    cleanupAfterSessionDestroy,
    createEditorSession,
    getDisplayName,
    getFileList,
    getLineWrappingEnabled,
    getLocalUser,
    getStoredUserName,
    getTheme,
    isExcalidrawFile,
    isImageFile,
    isMermaidFile,
    isPlantUmlFile,
    isTabActive,
    loadEditorSessionClass,
    loadBacklinks,
    onBeforeFileOpen,
    onConnectionChange,
    onContentChange,
    onCommentsChange,
    onFileAwarenessChange,
    onFileOpenError,
    onFileOpenReady,
    onImagePaste,
    onSelectionChange,
    onSessionAssigned = null,
    onRenderExcalidrawPreview,
    onRenderImagePreview,
    onSyncWrapToggle,
    onUpdateActiveFile,
    onUpdateCurrentFile,
    onUpdateLobbyCurrentFile,
    onUpdateVisibleChrome,
    onViewModeReset,
    renderPresence,
    scrollContainerForSession,
    showEditorLoading,
    stateStore,
  }) {
    this.attachEditorScroller = attachEditorScroller;
    this.beginDocumentLoad = beginDocumentLoad;
    this.cleanupAfterSessionDestroy = cleanupAfterSessionDestroy;
    this.createEditorSession = createEditorSession;
    this.getDisplayName = getDisplayName;
    this.getFileList = getFileList;
    this.getLineWrappingEnabled = getLineWrappingEnabled;
    this.getLocalUser = getLocalUser;
    this.getStoredUserName = getStoredUserName;
    this.getTheme = getTheme;
    this.isExcalidrawFile = isExcalidrawFile ?? (() => false);
    this.isImageFile = isImageFile ?? (() => false);
    this.isMermaidFile = isMermaidFile ?? (() => false);
    this.isPlantUmlFile = isPlantUmlFile ?? (() => false);
    this.isTabActive = isTabActive;
    this.loadEditorSessionClassPort = loadEditorSessionClass;
    this.loadBacklinks = loadBacklinks;
    this.onBeforeFileOpen = onBeforeFileOpen;
    this.onConnectionChange = onConnectionChange;
    this.onContentChange = onContentChange;
    this.onCommentsChange = onCommentsChange;
    this.onFileAwarenessChange = onFileAwarenessChange;
    this.onFileOpenError = onFileOpenError;
    this.onFileOpenReady = onFileOpenReady;
    this.onImagePaste = onImagePaste;
    this.onSelectionChange = onSelectionChange;
    this.onSessionAssigned = onSessionAssigned;
    this.onRenderExcalidrawPreview = onRenderExcalidrawPreview;
    this.onSyncWrapToggle = onSyncWrapToggle;
    this.onUpdateActiveFile = onUpdateActiveFile;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.onUpdateVisibleChrome = onUpdateVisibleChrome;
    this.renderPresence = renderPresence;
    this.stateStore = stateStore;
    this.session = null;
    this.lifecycle = new FileOpenLifecycle({
      attachEditorScroller,
      createEditorSession,
      loadEditorSessionClass: () => this.loadEditorSessionClassPort(),
      scrollContainerForSession,
    });
    this.chromeController = new WorkspaceChromeController({
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
    });
  }

  getSession() {
    return this.session;
  }

  loadEditorSessionClass() {
    return this.loadEditorSessionClassPort();
  }

  waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.lifecycle.clearSessionScroller();
    this.cleanupAfterSessionDestroy();
  }

  async openFile(filePath) {
    if (!this.isTabActive()) {
      return;
    }

    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isImage = this.isImageFile(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);

    if (filePath === this.stateStore.get('currentFilePath') && (this.session || isExcalidraw || isImage)) {
      this.onUpdateActiveFile(filePath);
      this.onUpdateLobbyCurrentFile(filePath);
      return;
    }

    const loadToken = this.stateStore.nextSessionLoadToken();

    this.cleanupSession();
    const chromeState = this.chromeController.prepareForFileOpen(filePath, {
      resetConnectionState: !isExcalidraw && !isImage,
    });

    if (isExcalidraw || isImage) {
      this.onSessionAssigned?.(null);

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        return;
      }

      this.chromeController.markFileOpenReady(null);
      this.chromeController.finalizeFileOpen({
        filePath,
        isExcalidraw,
        isImage,
        session: null,
        supportsBacklinks: chromeState.supportsBacklinks,
      });
      return;
    }

    const session = await this.lifecycle.createSession({
      filePath,
      getFileList: this.getFileList,
      lineWrappingEnabled: this.getLineWrappingEnabled(),
      localUser: this.getLocalUser(),
      onAwarenessChange: (users) => this.onFileAwarenessChange(users),
      onConnectionChange: (state) => this.onConnectionChange(state),
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        this.onContentChange({
          isMermaid,
          isPlantUml,
        });
      },
      onImagePaste: (file) => this.onImagePaste?.(file),
      preferredUserName: this.getStoredUserName(),
      onSelectionChange: (anchor) => this.onSelectionChange?.(anchor),
      theme: this.getTheme(),
    });

    this.session = session;
    this.onSessionAssigned?.(session);

    try {
      await session.initialize(filePath);

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        session.destroy();
        return;
      }

      this.lifecycle.attachSessionScroller(session);
      session.applyTheme(this.getTheme());
      await session.waitForInitialSync();
      session.ensureInitialContent?.();

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        session.destroy();
        return;
      }

      this.chromeController.markFileOpenReady(session);
      session.requestMeasure();
      await this.waitForNextPaint();

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        session.destroy();
        return;
      }
      this.chromeController.finalizeFileOpen({
        filePath,
        isExcalidraw,
        session,
        supportsBacklinks: chromeState.supportsBacklinks,
      });
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.lifecycle.clearSessionScroller();
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        return;
      }

      this.chromeController.handleFileOpenError();
    }
  }
}
