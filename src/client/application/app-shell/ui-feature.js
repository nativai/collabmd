import { USER_NAME_MAX_LENGTH, normalizeUserName } from '../../domain/room.js';
import { isMarkdownFilePath, supportsBacklinksForFilePath, supportsCommentsForFilePath } from '../../../domain/file-kind.js';

export const uiFeature = {
  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.previewRenderer.scheduleWorkerPrewarm();
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.scrollSyncController.initialize();
    this.fileExplorer.initialize();
    this.gitPanel.initialize();
    this.gitDiffView.initialize();
    this.initializePreviewLayoutObserver();
    this.syncCurrentUserName();
    this.syncWrapToggle();
    this.syncChatNotificationButton();
    this.renderChat();
    void this.gitPanel.refresh({ force: true });
    this.elements.chatInput?.setAttribute('maxlength', String(this.lobbyChatMessageMaxLength));
    this.bindEvents();
    this.restoreSidebarState();
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();

    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('resize', this.createResizeHandler());

    this.fileExplorerReadyPromise = this.fileExplorer.refresh().then(() => {
      this.fileExplorerReady = true;
      if (this.isTabActive) {
        return this.handleHashChange();
      }
      return undefined;
    });
  },

  bindEvents() {
    this.elements.chatToggleButton?.addEventListener('click', () => {
      this.toggleChatPanel();
    });

    this.elements.chatForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleChatSubmit();
    });

    this.elements.chatNotificationButton?.addEventListener('click', () => {
      void this.handleChatNotificationToggle();
    });

    this.elements.shareButton?.addEventListener('click', () => {
      void this.copyCurrentLink();
    });

    this.elements.editNameButton?.addEventListener('click', () => {
      this.openDisplayNameDialog();
    });

    this.elements.displayNameCancel?.addEventListener('click', () => {
      this.elements.displayNameDialog?.close();
    });

    this.elements.gitCommitCancel?.addEventListener('click', () => {
      this.elements.gitCommitDialog?.close();
    });

    this.elements.gitCommitDialog?.addEventListener('close', () => {
      if (this.elements.gitCommitInput) {
        this.elements.gitCommitInput.value = '';
      }
    });

    this.elements.markdownToolbar?.addEventListener('click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-markdown-action]')
        : null;
      const action = button?.getAttribute('data-markdown-action');
      if (!action) {
        return;
      }

      this.applyMarkdownToolbarAction(action);
    });

    this.elements.displayNameForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleDisplayNameSubmit();
    });

    this.elements.gitCommitForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleGitCommitSubmit();
    });

    this.elements.tabLockTakeoverButton?.addEventListener('click', () => {
      this.handleTabTakeover();
    });

    this.elements.toggleWrapButton?.addEventListener('click', () => {
      this.toggleLineWrapping();
    });

    this.elements.commentSelectionButton?.addEventListener('click', () => {
      this.startCommentFromEditorSelection();
    });

    this.elements.previewContent?.addEventListener('click', (event) => {
      const wikiLink = event.target.closest('a.wiki-link[data-wiki-target]');
      if (!wikiLink) {
        return;
      }

      event.preventDefault();
      this.handleWikiLinkClick(wikiLink.dataset.wikiTarget);
    });

    this.elements.sidebarToggle?.addEventListener('click', () => {
      this.toggleSidebar();
    });

    this.elements.sidebarClose?.addEventListener('click', () => {
      this.closeSidebarOnMobile();
    });

    this.elements.filesSidebarTab?.addEventListener('click', () => {
      this.setSidebarTab('files');
    });

    this.elements.gitSidebarTab?.addEventListener('click', () => {
      if (!this.gitRepoAvailable) {
        return;
      }
      this.setSidebarTab('git');
    });

    document.addEventListener('pointerdown', (event) => {
      if (!this.chatIsOpen) {
        return;
      }

      if (this.elements.chatContainer?.contains(event.target)) {
        return;
      }

      this.closeChatPanel();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.chatIsOpen) {
        this.closeChatPanel();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        void this.toggleQuickSwitcher();
      }
    });
  },

  isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  },

  closeSidebarOnMobile() {
    const sidebar = this.elements.sidebar;
    if (!sidebar || !this.isMobileViewport()) return;
    if (sidebar.classList.contains('collapsed')) return;

    this.setSidebarVisibility(false);
  },

  toggleSidebar() {
    const sidebar = this.elements.sidebar;
    if (!sidebar) return;
    const isHidden = sidebar.classList.contains('collapsed');
    this.setSidebarVisibility(isHidden);
  },

  restoreSidebarState() {
    const sidebar = this.elements.sidebar;
    if (!sidebar) return;

    const isMobile = this.isMobileViewport();
    const stored = this.preferences.getSidebarVisible();
    let showSidebar = true;
    if (stored === 'true') {
      showSidebar = true;
    } else if (stored === 'false') {
      showSidebar = false;
    } else if (isMobile) {
      showSidebar = false;
    }

    this.applySidebarVisibility(showSidebar);
  },

  setSidebarVisibility(showSidebar) {
    this.applySidebarVisibility(showSidebar);
    this.preferences.setSidebarVisible(showSidebar);
  },

  applySidebarVisibility(showSidebar) {
    const sidebar = this.elements.sidebar;
    if (!sidebar) return;

    const isCollapsed = !showSidebar;
    const hideForMobile = isCollapsed && this.isMobileViewport();

    sidebar.classList.toggle('collapsed', isCollapsed);
    sidebar.toggleAttribute('hidden', hideForMobile);
    sidebar.setAttribute('aria-hidden', hideForMobile ? 'true' : 'false');
    sidebar.inert = isCollapsed;
  },

  setSidebarTab(tab) {
    const nextTab = tab === 'git' && this.gitRepoAvailable ? 'git' : 'files';
    this.activeSidebarTab = nextTab;

    this.elements.filesSidebarTab?.classList.toggle('active', nextTab === 'files');
    this.elements.gitSidebarTab?.classList.toggle('active', nextTab === 'git');
    document.getElementById('fileTree')?.classList.toggle('hidden', nextTab !== 'files');
    this.elements.fileSearch?.classList.toggle('hidden', nextTab !== 'files');
    this.elements.gitSearch?.classList.toggle('hidden', nextTab !== 'git');
    document.getElementById('gitPanel')?.classList.toggle('active', nextTab === 'git');
    document.getElementById('gitPanel')?.classList.toggle('hidden', nextTab !== 'git');
    this.gitPanel.setActive(nextTab === 'git');
  },

  supportsComments(filePath = this.currentFilePath) {
    return supportsCommentsForFilePath(filePath);
  },

  startCommentFromEditorSelection() {
    if (!this.session || !this.supportsComments()) {
      return;
    }

    const range = this.session.getCurrentSelectionLineRange();
    if (!range) {
      this.toastController.show('Cannot anchor a comment without an editor selection');
      return;
    }

    if (this.layoutController.currentView === 'preview' || this.isMobileViewport()) {
      this.layoutController.setView('preview');
    } else if (this.layoutController.currentView === 'editor') {
      this.layoutController.setView('split');
    }

    this.commentsPanel.openComposerForRange(range);
  },

  applyMarkdownToolbarAction(action) {
    if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
      return;
    }

    const applied = this.session.applyMarkdownToolbarAction(action);
    if (!applied) {
      this.toastController.show('Formatting action is unavailable');
    }
  },

  navigateToCommentLine(lineNumber) {
    if (!Number.isFinite(lineNumber)) {
      return;
    }

    if (this.layoutController.currentView === 'preview' || this.isMobileViewport()) {
      this.layoutController.setView('split');
    }

    this.scrollSyncController.suspendSync(250);
    this.session?.scrollToLine(lineNumber, 0.2);
  },

  handleCommentThreadCreate(payload) {
    const threadId = this.session?.createCommentThread(payload);
    if (!threadId) {
      this.toastController.show('Comment cannot be empty');
    }

    return threadId;
  },

  handleCommentReply(threadId, body) {
    const messageId = this.session?.replyToCommentThread(threadId, body);
    if (!messageId) {
      this.toastController.show('Reply cannot be empty');
    }

    return messageId;
  },

  handleCommentResolution(threadId, resolved) {
    if (!resolved) {
      return false;
    }

    const didUpdate = this.session?.deleteCommentThread(threadId);
    if (!didUpdate) {
      this.toastController.show('Failed to resolve comment');
      return false;
    }

    return true;
  },

  updateCommentThreads(threads = []) {
    this.commentThreads = Array.isArray(threads) ? threads : [];
    this.commentsPanel.setThreads(this.commentThreads);
  },

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    if (!this.isExcalidrawFile(this.currentFilePath)) {
      this.previewRenderer.queueRender();
    }
    this.session?.applyTheme(theme);
    this.excalidrawEmbed.updateTheme(theme);
  },

  handleConnectionChange(state) {
    this.connectionState = state;
    this.renderPresence();

    if (state.firstConnection) {
      this.toastController.show('Connected');
    }

    if (state.unreachable && !this.connectionHelpShown) {
      this.connectionHelpShown = true;
      this.toastController.show(`Cannot reach server at ${state.wsBaseUrl}`, 6000);
    }
  },

  openDisplayNameDialog({ mode = 'edit' } = {}) {
    if (!this.isTabActive) {
      return;
    }

    const dialog = this.elements.displayNameDialog;
    const input = this.elements.displayNameInput;
    const title = this.elements.displayNameTitle;
    const copy = this.elements.displayNameCopy;
    const cancel = this.elements.displayNameCancel;
    const submit = this.elements.displayNameSubmit;
    if (!dialog || !input) return;

    const isOnboarding = mode === 'onboarding';
    if (title) {
      title.textContent = isOnboarding ? 'Choose your display name' : 'Update display name';
    }
    if (copy) {
      copy.textContent = isOnboarding
        ? 'Pick a name collaborators will see. You can skip for now and continue as a guest.'
        : 'Your name will be visible to everyone editing this vault.';
    }
    if (cancel) {
      cancel.textContent = isOnboarding ? 'Skip for now' : 'Cancel';
    }
    if (submit) {
      submit.textContent = isOnboarding ? 'Continue' : 'Save name';
    }

    input.value = isOnboarding ? '' : this.getCurrentUserName();
    if (dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
    requestAnimationFrame(() => { input.focus(); input.select(); });
  },

  promptForDisplayNameIfNeeded() {
    if (!this.isTabActive || this._hasPromptedForDisplayName || this.getStoredUserName()) {
      return;
    }

    this._hasPromptedForDisplayName = true;
    requestAnimationFrame(() => {
      this.openDisplayNameDialog({ mode: 'onboarding' });
    });
  },

  handleDisplayNameSubmit() {
    const input = this.elements.displayNameInput;
    const dialog = this.elements.displayNameDialog;
    if (!input || !dialog) return;

    const normalizedName = this.session
      ? this.session.setUserName(input.value)
      : normalizeUserName(input.value);
    if (!normalizedName) {
      input.focus();
      this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
      return;
    }

    this.preferences.setUserName(normalizedName);
    this.lobby.setUserName(normalizedName);
    this.excalidrawEmbed.updateLocalUser(this.lobby.getLocalUser());
    this.syncCurrentUserName();
    this.renderChat();
    dialog.close();
    this.toastController.show(`Display name: ${normalizedName}`);
  },

  async copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastController.show('Link copied');
    } catch {
      this.toastController.show('Failed to copy link');
    }
  },

  getCurrentUser() {
    return this.globalUsers.find((u) => u.isLocal)
      ?? this.session?.getLocalUser()
      ?? this.lobby?.getLocalUser()
      ?? null;
  },

  getCurrentUserName() {
    return this.getCurrentUser()?.name ?? this.getStoredUserName() ?? '';
  },

  getStoredUserName() {
    return this.preferences.getUserName();
  },

  syncCurrentUserName() {
    const el = this.elements.currentUserName;
    if (!el) return;
    const name = this.getCurrentUserName();
    el.textContent = name || 'Set name';
    el.classList.toggle('has-name', Boolean(name));
    this.elements.editNameButton?.setAttribute(
      'aria-label',
      `${name || 'Set name'}. Change display name`,
    );
  },

  toggleLineWrapping() {
    const currentState = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const nextState = !currentState;

    this.session?.setLineWrapping(nextState);
    this.preferences.setLineWrappingEnabled(nextState);
    this.syncWrapToggle(nextState);
    this.session?.requestMeasure();
    this.scrollSyncController.syncPreviewToEditor();
  },

  getStoredLineWrapping() {
    return this.preferences.getLineWrappingEnabled();
  },

  handleTabTakeover() {
    this.tabActivityLock.tryActivate({ takeover: true });
  },

  handleTabActivated({ takeover = false } = {}) {
    const wasInactive = !this.isTabActive;
    this.isTabActive = true;
    this.hideTabLockOverlay();

    if (!this.lobby.provider) {
      this.lobby.connect();
    }

    if (wasInactive) {
      if (this.fileExplorerReady) {
        void this.handleHashChange();
      }
      this.promptForDisplayNameIfNeeded();
    }

    if (takeover) {
      this.toastController.show('This tab is now active');
    }
  },

  handleTabBlocked({ reason } = {}) {
    const wasActive = this.isTabActive;
    this.isTabActive = false;
    if (this.elements.displayNameDialog?.open) {
      this.elements.displayNameDialog.close();
    }
    this.lobby.disconnect();
    this.globalUsers = [];
    this.chatMessages = [];
    this.chatMessageIds.clear();
    this.chatUnreadCount = 0;
    this.chatInitialSyncComplete = false;
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.showEmptyState();
    this.renderChat();
    this.showTabLockOverlay({ reason });

    if (wasActive && reason === 'taken-over') {
      this.toastController.show('Another tab took over this session');
    }
  },

  showTabLockOverlay({ reason } = {}) {
    const overlay = this.elements.tabLockOverlay;
    const title = this.elements.tabLockTitle;
    const copy = this.elements.tabLockCopy;
    if (!overlay) return;

    if (title) {
      title.textContent = reason === 'taken-over'
        ? 'This tab is no longer active'
        : 'This vault is active in another tab';
    }

    if (copy) {
      copy.textContent = reason === 'taken-over'
        ? 'Another tab took over the live session. This tab is now disconnected until you explicitly take over here again.'
        : 'To avoid duplicate presence and chat, only one tab can stay connected at a time. Use the other tab, or take over the session here.';
    }

    overlay.classList.remove('hidden');
  },

  hideTabLockOverlay() {
    this.elements.tabLockOverlay?.classList.add('hidden');
  },

  syncWrapToggle(state) {
    const enabled = state ?? this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const label = this.elements.wrapToggleLabel;
    const button = this.elements.toggleWrapButton;
    const nextLabel = enabled ? 'Wrap on' : 'Wrap off';
    if (label) label.textContent = nextLabel;
    if (button) {
      button.setAttribute('aria-label', `${nextLabel}. ${enabled ? 'Disable line wrap' : 'Enable line wrap'}`);
    }
  },

  scheduleBacklinkRefresh() {
    clearTimeout(this._backlinkRefreshTimer);
    this._backlinkRefreshTimer = setTimeout(() => {
      if (supportsBacklinksForFilePath(this.currentFilePath)) {
        this.backlinksPanel.load(this.currentFilePath);
      }
    }, 2000);
  },

  showEditorLoading() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.classList.add('is-loading-editor');
    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading file...</span>
      </div>`;
  },

  hideEditorLoading() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.classList.remove('is-loading-editor');
    this.elements.editorContainer.querySelector('#editorLoading')?.remove();
  },

  showEditorLoadError() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.classList.remove('is-loading-editor');
    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <span class="loading-text">Failed to load file</span>
      </div>`;
  },

  clearInitialFileBootstrap() {
    document.documentElement.removeAttribute('data-initial-file-requested');
  },
};
