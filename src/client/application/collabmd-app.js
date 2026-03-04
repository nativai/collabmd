import { PreviewRenderer } from './preview-renderer.js';
import { generateRoomId } from '../domain/room.js';
import { EditorSession } from '../infrastructure/editor-session.js';
import { getRoomFromHash, navigateToRoom } from '../infrastructure/runtime-config.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';

export class CollabMdApp {
  constructor() {
    this.elements = {
      backButton: document.getElementById('backToLanding'),
      createRoomButton: document.getElementById('createRoomBtn'),
      editorContainer: document.getElementById('editorContainer'),
      editorPage: document.getElementById('editor-page'),
      joinRoomButton: document.getElementById('joinRoomBtn'),
      landingPage: document.getElementById('landing'),
      lineInfo: document.getElementById('lineInfo'),
      previewContent: document.getElementById('previewContent'),
      roomInput: document.getElementById('roomInput'),
      roomName: document.getElementById('roomName'),
      shareButton: document.getElementById('shareBtn'),
      toastContainer: document.getElementById('toastContainer'),
      userAvatars: document.getElementById('userAvatars'),
      userCount: document.getElementById('userCount'),
    };

    this.session = null;
    this.onlineUsers = [];
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.sessionLoadToken = 0;
    this.connectionHelpShown = false;

    this.toastController = new ToastController(this.elements.toastContainer);
    this.outlineController = new OutlineController();
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.session?.getText() ?? '',
      outlineController: this.outlineController,
      previewElement: this.elements.previewContent,
    });
    this.themeController = new ThemeController({
      onChange: (theme) => this.handleThemeChange(theme),
    });
    this.layoutController = new LayoutController({
      onMeasureEditor: () => this.session?.requestMeasure(),
    });
  }

  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.bindEvents();

    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('resize', this.createResizeHandler());

    this.handleHashChange();
  }

  bindEvents() {
    this.elements.createRoomButton?.addEventListener('click', () => {
      navigateToRoom(generateRoomId());
    });

    this.elements.joinRoomButton?.addEventListener('click', () => {
      const roomId = this.elements.roomInput?.value.trim();
      if (!roomId) {
        this.elements.roomInput?.focus();
        this.toastController.show('Enter a room name to join');
        return;
      }

      navigateToRoom(roomId);
    });

    this.elements.roomInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.elements.joinRoomButton?.click();
      }
    });

    this.elements.backButton?.addEventListener('click', () => {
      window.location.hash = '';
    });

    this.elements.shareButton?.addEventListener('click', () => {
      void this.copyCurrentRoomLink();
    });
  }

  createResizeHandler() {
    let resizeTimer = null;

    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.session?.requestMeasure();
      }, 100);
    };
  }

  async handleHashChange() {
    const roomId = getRoomFromHash();

    if (!roomId) {
      this.showLanding();
      return;
    }

    await this.showEditor(roomId);
  }

  showLanding() {
    this.sessionLoadToken += 1;
    this.cleanupSession();

    this.elements.landingPage?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.previewContent.innerHTML = '';
    this.elements.userAvatars.innerHTML = '';
    this.elements.userCount.textContent = 'Offline';
    this.elements.userCount.style.opacity = '0.6';
  }

  async showEditor(roomId) {
    const loadToken = this.sessionLoadToken + 1;
    this.sessionLoadToken = loadToken;

    this.cleanupSession();
    this.layoutController.reset();
    this.connectionHelpShown = false;
    this.onlineUsers = [];
    this.connectionState = { status: 'connecting', unreachable: false };

    this.elements.landingPage?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');
    this.elements.roomName.textContent = roomId;
    this.showEditorLoading();
    this.renderPresence();

    const session = new EditorSession({
      editorContainer: this.elements.editorContainer,
      initialTheme: this.themeController.getTheme(),
      lineInfoElement: this.elements.lineInfo,
      onAwarenessChange: (users) => this.updateOnlineUsers(users),
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: () => this.previewRenderer.queueRender(),
    });

    this.session = session;

    try {
      await session.initialize(roomId);

      if (loadToken !== this.sessionLoadToken) {
        session.destroy();
        return;
      }

      session.applyTheme(this.themeController.getTheme());
      this.previewRenderer.queueRender();
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.sessionLoadToken) {
        return;
      }

      this.showEditorLoadError();
      this.toastController.show('Failed to initialize editor');
    }
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.outlineController.cleanup();
  }

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    this.previewRenderer.queueRender();
    this.session?.applyTheme(theme);
  }

  handleConnectionChange(state) {
    this.connectionState = state;
    this.renderPresence();

    if (state.firstConnection) {
      this.toastController.show('Connected to collaboration server');
    }

    if (state.unreachable && !this.connectionHelpShown) {
      this.connectionHelpShown = true;
      this.toastController.show(`Cannot reach collaboration server at ${state.wsBaseUrl}`, 6000);
    }
  }

  updateOnlineUsers(users) {
    this.onlineUsers = users;
    this.renderAvatars();
    this.renderPresence();
  }

  renderPresence() {
    const badge = this.elements.userCount;
    if (!badge) {
      return;
    }

    if (this.connectionState.status === 'connected') {
      badge.textContent = `${this.onlineUsers.length} online`;
      badge.style.opacity = '1';
      return;
    }

    if (this.connectionState.status === 'connecting') {
      badge.textContent = this.connectionState.unreachable ? 'Server unreachable' : 'Connecting...';
      badge.style.opacity = '0.6';
      return;
    }

    badge.textContent = 'Offline';
    badge.style.opacity = '0.6';
  }

  renderAvatars() {
    const avatars = this.elements.userAvatars;
    if (!avatars) {
      return;
    }

    avatars.innerHTML = '';

    this.onlineUsers.slice(0, 5).forEach((user) => {
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.style.backgroundColor = user.color;
      avatar.textContent = user.name.charAt(0).toUpperCase();
      avatar.title = `${user.name}${user.isLocal ? ' (you)' : ''}`;
      avatars.appendChild(avatar);
    });

    if (this.onlineUsers.length > 5) {
      const overflow = document.createElement('div');
      overflow.className = 'user-avatar';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      overflow.textContent = `+${this.onlineUsers.length - 5}`;
      avatars.appendChild(overflow);
    }
  }

  showEditorLoading() {
    if (!this.elements.editorContainer) {
      return;
    }

    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading editor...</span>
      </div>
    `;
  }

  showEditorLoadError() {
    if (!this.elements.editorContainer) {
      return;
    }

    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <span class="loading-text" style="color:var(--color-error)">Failed to load editor modules</span>
      <button class="btn btn-secondary" type="button" id="retryLoadEditor" style="margin-top:var(--space-2)">Retry</button>
      </div>
    `;

    this.elements.editorContainer.querySelector('#retryLoadEditor')?.addEventListener('click', () => {
      void this.handleHashChange();
    });
  }

  async copyCurrentRoomLink() {
    const roomUrl = window.location.href;

    try {
      await navigator.clipboard.writeText(roomUrl);
      this.toastController.show('Room link copied to clipboard');
      return;
    } catch {
      // Fallback to a hidden textarea for older browser contexts.
    }

    const textArea = document.createElement('textarea');
    textArea.value = roomUrl;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand('copy');
      this.toastController.show('Room link copied');
    } catch {
      this.toastController.show('Could not copy room link');
    } finally {
      textArea.remove();
    }
  }
}
