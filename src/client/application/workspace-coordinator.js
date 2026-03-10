import {
  isMarkdownFilePath,
  supportsBacklinksForFilePath,
  supportsCommentsForFilePath,
} from '../../domain/file-kind.js';

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
    isMermaidFile,
    isPlantUmlFile,
    isTabActive,
    loadEditorSessionClass,
    loadBacklinks,
    onBeforeFileOpen,
    onCommentsChange,
    onConnectionChange,
    onContentChange,
    onFileAwarenessChange,
    onFileOpenError,
    onFileOpenReady,
    onSessionAssigned = null,
    onRenderExcalidrawPreview,
    onSyncWrapToggle,
    onUpdateActiveFile,
    onUpdateCurrentFile,
    onUpdateLobbyCurrentFile,
    onUpdateVisibleChrome,
    onViewModeReset,
    renderPresence,
    scrollContainerForSession,
    setCommentsFile,
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
    this.isExcalidrawFile = isExcalidrawFile;
    this.isMermaidFile = isMermaidFile;
    this.isPlantUmlFile = isPlantUmlFile;
    this.isTabActive = isTabActive;
    this.loadEditorSessionClassPort = loadEditorSessionClass;
    this.loadBacklinks = loadBacklinks;
    this.onBeforeFileOpen = onBeforeFileOpen;
    this.onCommentsChange = onCommentsChange;
    this.onConnectionChange = onConnectionChange;
    this.onContentChange = onContentChange;
    this.onFileAwarenessChange = onFileAwarenessChange;
    this.onFileOpenError = onFileOpenError;
    this.onFileOpenReady = onFileOpenReady;
    this.onSessionAssigned = onSessionAssigned;
    this.onRenderExcalidrawPreview = onRenderExcalidrawPreview;
    this.onSyncWrapToggle = onSyncWrapToggle;
    this.onUpdateActiveFile = onUpdateActiveFile;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.onUpdateVisibleChrome = onUpdateVisibleChrome;
    this.onViewModeReset = onViewModeReset;
    this.renderPresence = renderPresence;
    this.scrollContainerForSession = scrollContainerForSession;
    this.setCommentsFile = setCommentsFile;
    this.showEditorLoading = showEditorLoading;
    this.stateStore = stateStore;
    this.session = null;
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
    this.attachEditorScroller(null);
    this.cleanupAfterSessionDestroy();
  }

  async openFile(filePath) {
    if (!this.isTabActive()) {
      return;
    }

    if (filePath === this.stateStore.get('currentFilePath') && this.session) {
      this.onUpdateActiveFile(filePath);
      this.onUpdateLobbyCurrentFile(filePath);
      return;
    }

    const loadToken = this.stateStore.nextSessionLoadToken();
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const supportsComments = supportsCommentsForFilePath(filePath);

    this.cleanupSession();
    this.onViewModeReset();
    this.onBeforeFileOpen();
    this.stateStore.set('connectionHelpShown', false);
    this.stateStore.set('connectionState', { status: 'connecting', unreachable: false });
    this.stateStore.set('currentFilePath', filePath);
    this.onUpdateCurrentFile(filePath);
    this.onUpdateLobbyCurrentFile(filePath);
    this.onUpdateActiveFile(filePath);
    this.onUpdateVisibleChrome(filePath, {
      displayName: this.getDisplayName(filePath),
      isMarkdown: isMarkdownFilePath(filePath),
    });
    this.setCommentsFile(filePath, { supported: supportsComments });
    this.onCommentsChange([]);
    this.showEditorLoading();
    this.beginDocumentLoad();
    this.renderPresence();

    const EditorSession = await this.loadEditorSessionClass();
    const session = this.createEditorSession(EditorSession, {
      filePath,
      getFileList: this.getFileList,
      lineWrappingEnabled: this.getLineWrappingEnabled(),
      localUser: this.getLocalUser(),
      onAwarenessChange: (users) => this.onFileAwarenessChange(users),
      onCommentsChange: (threads) => this.onCommentsChange(threads),
      onConnectionChange: (state) => this.onConnectionChange(state),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        this.onContentChange({
          isMermaid,
          isPlantUml,
        });
      },
      preferredUserName: this.getStoredUserName(),
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

      this.attachEditorScroller(this.scrollContainerForSession(session));
      session.applyTheme(this.getTheme());
      await session.waitForInitialSync();
      session.requestMeasure();
      await this.waitForNextPaint();

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        session.destroy();
        return;
      }

      this.onFileOpenReady(session);
      if (isExcalidraw) {
        this.onRenderExcalidrawPreview(filePath);
      }
      this.onSyncWrapToggle();
      this.onCommentsChange(session.getCommentThreads());
      if (supportsBacklinksForFilePath(filePath)) {
        this.loadBacklinks(filePath);
      }
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.attachEditorScroller(null);
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.stateStore.get('sessionLoadToken')) {
        return;
      }

      this.onFileOpenError();
    }
  }
}
