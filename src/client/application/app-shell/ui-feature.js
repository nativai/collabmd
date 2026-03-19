import { USER_NAME_MAX_LENGTH, normalizeUserName } from '../../domain/room.js';
import { isMarkdownFilePath, supportsBacklinksForFilePath } from '../../../domain/file-kind.js';

const IMAGE_FILE_PICKER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

export const uiFeature = {
  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.previewRenderer.scheduleWorkerPrewarm();
    this.scheduleEditorSessionPrewarm?.();
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.scrollSyncController.initialize();
    this.fileExplorer.initialize();
    this.gitPanel.initialize();
    this.gitDiffView.initialize();
    this.initializePreviewLayoutObserver();
    this.syncIdentityManagementUi();
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

  isIdentityManagedByAuth() {
    return this.runtimeConfig?.auth?.strategy === 'oidc'
      && this.runtimeConfig?.auth?.provider === 'google';
  },

  bindEvents() {
    this.elements.emptyStateNewFileBtn?.addEventListener('click', () => {
      this.fileExplorer.actionController.handleNewFile();
    });

    this.elements.emptyStateSearchBtn?.addEventListener('click', () => {
      void this.toggleQuickSwitcher();
    });

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

    this.elements.gitResetCancel?.addEventListener('click', () => {
      this.elements.gitResetDialog?.close();
    });

    this.elements.gitResetSubmit?.addEventListener('click', () => {
      void this.handleGitResetSubmit();
    });

    this.elements.gitCommitDialog?.addEventListener('close', () => {
      if (this.elements.gitCommitInput) {
        this.elements.gitCommitInput.value = '';
      }
      if (this.elements.gitCommitSubmit) {
        this.elements.gitCommitSubmit.textContent = 'Commit staged changes';
      }
    });

    this.elements.gitResetDialog?.addEventListener('close', () => {
      this.pendingGitResetPath = null;
      if (this.elements.gitResetFileName) {
        this.elements.gitResetFileName.value = '';
      }
      if (this.elements.gitResetSubmit) {
        this.elements.gitResetSubmit.textContent = 'Reset File';
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
    return this.mobileBreakpointQuery.matches;
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

  applyMarkdownToolbarAction(action) {
    if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
      return;
    }

    if (action === 'image') {
      void this.handleToolbarImageInsert();
      return;
    }

    const applied = this.session.applyMarkdownToolbarAction(action);
    if (!applied) {
      this.toastController.show('Formatting action is unavailable');
    }
  },

  async handleToolbarImageInsert() {
    const file = await this.pickImageFile();
    if (!file) {
      return;
    }

    await this.handleEditorImageInsert(file);
  },

  pickImageFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = IMAGE_FILE_PICKER_ACCEPT;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      let settled = false;
      let focusTimer = null;

      const cleanup = (value) => {
        if (settled) {
          return;
        }

        settled = true;
        if (focusTimer) {
          window.clearTimeout(focusTimer);
        }
        window.removeEventListener('focus', handleWindowFocus);
        input.remove();
        resolve(value);
      };

      const handleWindowFocus = () => {
        focusTimer = window.setTimeout(() => {
          if (settled || input.files?.length) {
            return;
          }

          cleanup(null);
        }, 250);
      };

      input.addEventListener('change', () => {
        cleanup(input.files?.[0] ?? null);
      }, { once: true });

      input.addEventListener('cancel', () => {
        cleanup(null);
      }, { once: true });

      window.addEventListener('focus', handleWindowFocus, { once: true });
      input.click();
    });
  },

  async handleEditorImageInsert(file) {
    if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
      console.warn('[ui] Ignoring image insert because there is no active markdown session.', {
        currentFilePath: this.currentFilePath,
        hasSession: Boolean(this.session),
      });
      return false;
    }

    const activeFilePath = this.currentFilePath;
    const activeSession = this.session;

    try {
      console.debug('[ui] Uploading image attachment.', {
        fileName: file?.name || '',
        size: file?.size ?? null,
        sourcePath: activeFilePath,
        type: file?.type || '',
      });
      const result = await this.vaultApiClient.uploadImageAttachment({
        file,
        fileName: file?.name || '',
        sourcePath: activeFilePath,
      });

      await this.fileExplorer.refresh();

      if (
        this.currentFilePath === activeFilePath
        && this.session
        && this.session === activeSession
        && typeof result?.markdown === 'string'
      ) {
        console.debug('[ui] Inserting uploaded image markdown into the editor.', {
          sourcePath: activeFilePath,
          storedPath: result.path ?? '',
        });
        this.session.insertText(result.markdown);
      }

      return true;
    } catch (error) {
      console.error('[ui] Failed to insert image attachment:', error);
      this.toastController.show(error.message || 'Failed to upload image');
      return false;
    }
  },

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    if (!this.isExcalidrawFile(this.currentFilePath) && !this.isImageFile?.(this.currentFilePath)) {
      this.previewRenderer.queueRender();
    }
    this.session?.applyTheme(theme);
    this.excalidrawEmbed.updateTheme(theme);
  },

  handleConnectionChange(state) {
    this.connectionState = state;
    if (state?.firstConnection) {
      this.recordFileOpenMetric?.('ws_connected', {
        status: state.status,
      });
    }
    this.renderPresence();

    if (state.unreachable && !this.connectionHelpShown) {
      this.connectionHelpShown = true;
      this.toastController.show(`Cannot reach server at ${state.wsBaseUrl}`, 6000);
    }
  },

  openDisplayNameDialog({ mode = 'edit' } = {}) {
    if (this.isIdentityManagedByAuth()) {
      return;
    }

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
    if (
      !this.isTabActive
      || this._hasPromptedForDisplayName
      || this.getStoredUserName()
      || this.isIdentityManagedByAuth()
    ) {
      return;
    }

    this._hasPromptedForDisplayName = true;
    requestAnimationFrame(() => {
      this.openDisplayNameDialog({ mode: 'onboarding' });
    });
  },

  handleDisplayNameSubmit() {
    if (this.isIdentityManagedByAuth()) {
      return;
    }

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
    if (!this.isIdentityManagedByAuth()) {
      this.elements.editNameButton?.setAttribute(
        'aria-label',
        `${name || 'Set name'}. Change display name`,
      );
    }
  },

  syncIdentityManagementUi() {
    const isManaged = this.isIdentityManagedByAuth();
    this.elements.editNameButton?.classList.toggle('hidden', isManaged);
    this.elements.editNameButton?.toggleAttribute('disabled', isManaged);
    if (isManaged && this.elements.displayNameDialog?.open) {
      this.elements.displayNameDialog.close();
    }
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
    if (!this.workspaceSync.provider) {
      this.workspaceSync.connect();
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

  async handleTabBlocked({ reason } = {}) {
    const wasActive = this.isTabActive;
    const blockedFilePath = this.currentFilePath;
    const shouldPrepareExcalidrawDisconnect = Boolean(
      blockedFilePath
      && this.isExcalidrawFile?.(blockedFilePath),
    );

    this.isTabActive = false;
    if (this.elements.displayNameDialog?.open) {
      this.elements.displayNameDialog.close();
    }
    this.lobby.disconnect();
    this.workspaceSync.disconnect();
    this.globalUsers = [];
    this.chatMessages = [];
    this.chatMessageIds.clear();
    this.chatUnreadCount = 0;
    this.chatInitialSyncComplete = false;
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.showTabLockOverlay({ reason });

    if (shouldPrepareExcalidrawDisconnect) {
      await this.excalidrawEmbed.prepareFileDisconnect(blockedFilePath);
    }

    this.showEmptyState();
    this.renderChat();

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
