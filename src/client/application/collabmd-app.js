import { PreviewRenderer } from './preview-renderer.js';
import { USER_NAME_MAX_LENGTH, normalizeUserName, generateRoomId } from '../domain/room.js';
import { EditorSession } from '../infrastructure/editor-session.js';
import { getFileFromHash, navigateToFile } from '../infrastructure/runtime-config.js';
import { FileExplorerController } from '../presentation/file-explorer-controller.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { ScrollSyncController } from '../presentation/scroll-sync-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';

export class CollabMdApp {
  constructor() {
    this.elements = {
      currentUserName: document.getElementById('currentUserName'),
      displayNameCancel: document.getElementById('displayNameCancel'),
      displayNameDialog: document.getElementById('displayNameDialog'),
      displayNameForm: document.getElementById('displayNameForm'),
      displayNameInput: document.getElementById('displayNameInput'),
      editNameButton: document.getElementById('editNameBtn'),
      editorContainer: document.getElementById('editorContainer'),
      editorPage: document.getElementById('editor-page'),
      lineInfo: document.getElementById('lineInfo'),
      previewContent: document.getElementById('previewContent'),
      previewContainer: document.getElementById('previewContainer'),
      shareButton: document.getElementById('shareBtn'),
      toastContainer: document.getElementById('toastContainer'),
      toggleWrapButton: document.getElementById('toggleWrapBtn'),
      userAvatars: document.getElementById('userAvatars'),
      userCount: document.getElementById('userCount'),
      wrapToggleLabel: document.getElementById('wrapToggleLabel'),
      activeFileName: document.getElementById('activeFileName'),
      sidebarToggle: document.getElementById('sidebarToggle'),
      sidebar: document.getElementById('sidebar'),
      emptyState: document.getElementById('emptyState'),
    };

    this.session = null;
    this.currentFilePath = null;
    this.onlineUsers = [];
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.sessionLoadToken = 0;
    this.connectionHelpShown = false;
    this.userNameStorageKey = 'collabmd-user-name';
    this.lineWrappingStorageKey = 'collabmd-editor-line-wrap';
    this.sidebarVisibleKey = 'collabmd-sidebar-visible';
    this.followedUserClientId = null;
    this.followedCursorSignature = '';

    this.toastController = new ToastController(this.elements.toastContainer);
    this.fileExplorer = new FileExplorerController({
      onFileSelect: (filePath) => navigateToFile(filePath),
      onFileDelete: () => navigateToFile(null),
    });
    this.outlineController = new OutlineController({
      onNavigateToHeading: ({ sourceLine }) => {
        if (!Number.isFinite(sourceLine)) return;
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.session?.getText() ?? '',
      onRenderComplete: () => {
        requestAnimationFrame(() => {
          this.scrollSyncController.invalidatePreviewBlocks();
          this.scrollSyncController.syncPreviewToEditor();
        });
      },
      onWikiLinkClick: (target) => this.handleWikiLinkClick(target),
      outlineController: this.outlineController,
      previewElement: this.elements.previewContent,
    });
    this.themeController = new ThemeController({
      onChange: (theme) => this.handleThemeChange(theme),
    });
    this.layoutController = new LayoutController({
      onMeasureEditor: () => this.session?.requestMeasure(),
    });
    this.scrollSyncController = new ScrollSyncController({
      getEditorLineNumber: () => this.session?.getTopVisibleLineNumber(0.35) ?? 1,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      scrollEditorToLine: (lineNumber, viewportRatio) => this.session?.scrollToLine(lineNumber, viewportRatio),
    });
  }

  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.scrollSyncController.initialize();
    this.fileExplorer.initialize();
    this.syncCurrentUserName();
    this.syncWrapToggle();
    this.bindEvents();
    this.restoreSidebarState();

    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('resize', this.createResizeHandler());

    this.fileExplorer.refresh().then(() => {
      this.handleHashChange();
    });
  }

  bindEvents() {
    this.elements.shareButton?.addEventListener('click', () => {
      void this.copyCurrentLink();
    });

    this.elements.editNameButton?.addEventListener('click', () => {
      this.openDisplayNameDialog();
    });

    this.elements.displayNameCancel?.addEventListener('click', () => {
      this.elements.displayNameDialog?.close();
    });

    this.elements.displayNameForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleDisplayNameSubmit();
    });

    this.elements.toggleWrapButton?.addEventListener('click', () => {
      this.toggleLineWrapping();
    });

    this.elements.sidebarToggle?.addEventListener('click', () => {
      this.toggleSidebar();
    });
  }

  createResizeHandler() {
    let resizeTimer = null;
    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.session?.requestMeasure();
        this.scrollSyncController.invalidatePreviewBlocks();
        this.scrollSyncController.syncPreviewToEditor();
      }, 100);
    };
  }

  async handleHashChange() {
    const filePath = getFileFromHash();

    if (!filePath) {
      this.showEmptyState();
      return;
    }

    await this.openFile(filePath);
  }

  showEmptyState() {
    this.sessionLoadToken += 1;
    this.cleanupSession();
    this.currentFilePath = null;
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.previewContent.innerHTML = '';
    this.elements.userAvatars.innerHTML = '';
    this.elements.userCount.textContent = '';

    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = 'CollabMD';
    }
  }

  async openFile(filePath) {
    const loadToken = this.sessionLoadToken + 1;
    this.sessionLoadToken = loadToken;

    this.cleanupSession();
    this.layoutController.reset();
    this.connectionHelpShown = false;
    this.onlineUsers = [];
    this.connectionState = { status: 'connecting', unreachable: false };
    this.currentFilePath = filePath;

    this.fileExplorer.setActiveFile(filePath);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');

    const displayName = filePath.split('/').pop().replace(/\.md$/i, '');
    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = displayName;
    }

    this.showEditorLoading();
    this.renderPresence();

    const session = new EditorSession({
      editorContainer: this.elements.editorContainer,
      lineWrappingEnabled: this.getStoredLineWrapping(),
      initialTheme: this.themeController.getTheme(),
      lineInfoElement: this.elements.lineInfo,
      onAwarenessChange: (users) => this.updateOnlineUsers(users),
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: () => this.previewRenderer.queueRender(),
      preferredUserName: this.getStoredUserName(),
    });

    this.session = session;

    try {
      await session.initialize(filePath);

      if (loadToken !== this.sessionLoadToken) {
        session.destroy();
        return;
      }

      this.scrollSyncController.attachEditorScroller(session.getScrollContainer());
      session.applyTheme(this.themeController.getTheme());
      this.syncWrapToggle();
      this.previewRenderer.queueRender();
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.scrollSyncController.attachEditorScroller(null);
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.sessionLoadToken) return;

      this.showEditorLoadError();
      this.syncWrapToggle();
      this.toastController.show('Failed to initialize editor');
    }
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.scrollSyncController.attachEditorScroller(null);
    this.outlineController.cleanup();
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
  }

  handleWikiLinkClick(target) {
    const files = this.fileExplorer.flatFiles;
    const normalized = target.endsWith('.md') ? target : `${target}.md`;

    const match = files.find((f) => {
      return f === normalized || f.endsWith(`/${normalized}`) || f.replace(/\.md$/i, '') === target;
    });

    if (match) {
      navigateToFile(match);
    } else {
      this.toastController.show(`File not found: ${target}`);
    }
  }

  // Sidebar

  toggleSidebar() {
    const sidebar = this.elements.sidebar;
    if (!sidebar) return;
    const isHidden = sidebar.classList.toggle('collapsed');
    localStorage.setItem(this.sidebarVisibleKey, isHidden ? 'false' : 'true');
  }

  restoreSidebarState() {
    const stored = localStorage.getItem(this.sidebarVisibleKey);
    if (stored === 'false') {
      this.elements.sidebar?.classList.add('collapsed');
    }
  }

  // Line wrapping

  toggleLineWrapping() {
    const currentState = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const nextState = !currentState;

    this.session?.setLineWrapping(nextState);
    this.storeLineWrapping(nextState);
    this.syncWrapToggle(nextState);
    this.session?.requestMeasure();
    this.scrollSyncController.syncPreviewToEditor();
  }

  // Theme

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    this.previewRenderer.queueRender();
    this.session?.applyTheme(theme);
  }

  // Connection

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
  }

  // Presence

  updateOnlineUsers(users) {
    this.onlineUsers = users;
    this.syncFollowedUser();
    this.renderAvatars();
    this.renderPresence();
    this.syncCurrentUserName();
  }

  renderPresence() {
    const badge = this.elements.userCount;
    if (!badge) return;

    if (this.connectionState.status === 'connected') {
      badge.textContent = `${this.onlineUsers.length} online`;
      badge.style.opacity = '1';
      return;
    }

    if (this.connectionState.status === 'connecting') {
      badge.textContent = this.connectionState.unreachable ? 'Unreachable' : 'Connecting...';
      badge.style.opacity = '0.6';
      return;
    }

    badge.textContent = 'Offline';
    badge.style.opacity = '0.6';
  }

  renderAvatars() {
    const avatars = this.elements.userAvatars;
    if (!avatars) return;

    avatars.innerHTML = '';
    const visibleUsers = [...this.onlineUsers];
    const followedIndex = visibleUsers.findIndex((u) => u.clientId === this.followedUserClientId);
    if (followedIndex > 0) {
      const [followed] = visibleUsers.splice(followedIndex, 1);
      visibleUsers.unshift(followed);
    }

    visibleUsers.slice(0, 5).forEach((user) => {
      const avatar = document.createElement(user.isLocal ? 'div' : 'button');
      avatar.className = 'user-avatar';
      avatar.style.backgroundColor = user.color;
      avatar.textContent = user.name.charAt(0).toUpperCase();
      avatar.classList.toggle('is-following', user.clientId === this.followedUserClientId);

      if (user.isLocal) {
        avatar.title = `${user.name} (you)`;
      } else {
        avatar.type = 'button';
        avatar.classList.add('user-avatar-button');
        avatar.title = user.clientId === this.followedUserClientId
          ? `Stop following ${user.name}`
          : `Follow ${user.name}`;
        avatar.addEventListener('click', () => this.toggleFollowUser(user.clientId));
      }

      avatars.appendChild(avatar);
    });

    if (visibleUsers.length > 5) {
      const overflow = document.createElement('div');
      overflow.className = 'user-avatar';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      overflow.textContent = `+${visibleUsers.length - 5}`;
      avatars.appendChild(overflow);
    }
  }

  // Follow user

  toggleFollowUser(clientId) {
    if (!clientId) return;

    if (this.followedUserClientId === clientId) {
      this.stopFollowingUser();
      return;
    }

    const user = this.onlineUsers.find((u) => u.clientId === clientId && !u.isLocal);
    if (!user) return;

    this.followedUserClientId = clientId;
    this.followedCursorSignature = '';
    this.renderAvatars();
    requestAnimationFrame(() => {
      if (this.followedUserClientId === clientId) {
        this.followUserCursor(user, { force: true });
      }
    });

    this.toastController.show(
      user.hasCursor ? `Following ${user.name}` : `Following ${user.name}. Waiting for cursor.`,
    );
  }

  stopFollowingUser(showToast = true) {
    if (!this.followedUserClientId) return;
    const name = this.onlineUsers.find((u) => u.clientId === this.followedUserClientId)?.name ?? 'collaborator';
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.renderAvatars();
    if (showToast) this.toastController.show(`Stopped following ${name}`);
  }

  syncFollowedUser() {
    if (!this.followedUserClientId) return;
    const user = this.onlineUsers.find((u) => u.clientId === this.followedUserClientId);
    if (!user || user.isLocal) {
      this.stopFollowingUser(false);
      return;
    }
    this.followUserCursor(user);
  }

  followUserCursor(user, { force = false } = {}) {
    const liveCursor = user?.clientId ? this.session?.getUserCursor(user.clientId) : null;
    const cursorHead = liveCursor?.cursorHead ?? user?.cursorHead;
    const cursorLine = liveCursor?.cursorLine ?? user?.cursorLine;
    const cursorAnchor = liveCursor?.cursorAnchor ?? user?.cursorAnchor;

    if (!user || cursorHead == null || cursorLine == null) {
      this.followedCursorSignature = '';
      return;
    }

    const nextSig = `${user.clientId}:${cursorAnchor}:${cursorHead}`;
    if (!force && nextSig === this.followedCursorSignature) return;

    const didScroll = this.session?.scrollToUserCursor(user.clientId, 'center')
      || this.session?.scrollToPosition(cursorHead, 'center')
      || this.session?.scrollToLine(cursorLine);
    if (didScroll) this.followedCursorSignature = nextSig;
  }

  // Display name dialog

  openDisplayNameDialog() {
    const dialog = this.elements.displayNameDialog;
    const input = this.elements.displayNameInput;
    if (!dialog || !input) return;

    input.value = this.getCurrentUserName();
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  handleDisplayNameSubmit() {
    const input = this.elements.displayNameInput;
    const dialog = this.elements.displayNameDialog;
    if (!input || !dialog || !this.session) return;

    const normalizedName = this.session.setUserName(input.value);
    if (!normalizedName) {
      input.focus();
      this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
      return;
    }

    this.storeUserName(normalizedName);
    this.syncCurrentUserName();
    dialog.close();
    this.toastController.show(`Display name: ${normalizedName}`);
  }

  // Share

  async copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastController.show('Link copied');
    } catch {
      this.toastController.show('Failed to copy link');
    }
  }

  // User name storage

  getCurrentUser() {
    return this.onlineUsers.find((u) => u.isLocal) ?? this.session?.getLocalUser() ?? null;
  }

  getCurrentUserName() {
    return this.getCurrentUser()?.name ?? this.getStoredUserName() ?? '';
  }

  getStoredUserName() {
    try { return localStorage.getItem(this.userNameStorageKey) || ''; } catch { return ''; }
  }

  storeUserName(name) {
    try { localStorage.setItem(this.userNameStorageKey, name); } catch { /* ignore */ }
  }

  syncCurrentUserName() {
    const el = this.elements.currentUserName;
    if (!el) return;
    const name = this.getCurrentUserName();
    el.textContent = name || 'Set name';
    el.classList.toggle('has-name', Boolean(name));
  }

  // Line wrapping storage

  getStoredLineWrapping() {
    try { return localStorage.getItem(this.lineWrappingStorageKey) !== 'false'; } catch { return true; }
  }

  storeLineWrapping(enabled) {
    try { localStorage.setItem(this.lineWrappingStorageKey, String(enabled)); } catch { /* ignore */ }
  }

  syncWrapToggle(state) {
    const enabled = state ?? this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const label = this.elements.wrapToggleLabel;
    const button = this.elements.toggleWrapButton;
    if (label) label.textContent = enabled ? 'Wrap on' : 'Wrap off';
    if (button) button.setAttribute('aria-label', enabled ? 'Disable line wrap' : 'Enable line wrap');
  }

  // Editor loading states

  showEditorLoading() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading file...</span>
      </div>`;
  }

  showEditorLoadError() {
    if (!this.elements.editorContainer) return;
    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <span class="loading-text">Failed to load file</span>
      </div>`;
  }
}
