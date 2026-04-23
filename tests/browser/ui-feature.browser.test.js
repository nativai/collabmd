import { afterEach, describe, expect, it, vi } from 'vitest';

import { uiFeatureIdentityMethods } from '../../src/client/application/app-shell/ui-feature-identity.js';
import { uiFeatureShellMethods } from '../../src/client/application/app-shell/ui-feature-shell.js';
import { uiFeatureSidebarMethods } from '../../src/client/application/app-shell/ui-feature-sidebar.js';
import { uiFeatureToolbarMethods } from '../../src/client/application/app-shell/ui-feature-toolbar.js';
import { ensureQuickSwitcherInstance } from '../../src/client/application/quick-switcher-loader.js';

function createSidebarContext({ gitRepoAvailable = true, mobile = false } = {}) {
  document.body.innerHTML = `
    <aside id="sidebar"></aside>
    <button id="files-tab"></button>
    <button id="git-tab"></button>
    <section id="fileTree"></section>
    <section id="gitPanel"></section>
    <div id="file-search"></div>
    <div id="git-search"></div>
  `;

  const context = {
    activeSidebarTab: 'files',
    elements: {
      fileSearch: document.getElementById('file-search'),
      filesSidebarTab: document.getElementById('files-tab'),
      gitSearch: document.getElementById('git-search'),
      gitSidebarTab: document.getElementById('git-tab'),
      sidebar: document.getElementById('sidebar'),
    },
    gitPanel: {
      setActive: vi.fn(),
    },
    gitRepoAvailable,
    mobileBreakpointQuery: { matches: mobile },
    preferences: {
      getSidebarVisible: () => null,
      setSidebarVisible: vi.fn(),
    },
  };

  Object.assign(context, uiFeatureSidebarMethods);
  return context;
}

describe('uiFeature browser helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('switches sidebar tabs and updates visibility state', () => {
    const context = createSidebarContext();

    context.setSidebarTab('git');

    expect(context.activeSidebarTab).toBe('git');
    expect(context.elements.gitSidebarTab.classList.contains('active')).toBe(true);
    expect(document.getElementById('gitPanel').classList.contains('hidden')).toBe(false);
    expect(context.gitPanel.setActive).toHaveBeenCalledWith(true);
  });

  it('collapses the sidebar for mobile restores', () => {
    const context = createSidebarContext({ mobile: true });

    context.restoreSidebarState();

    expect(context.elements.sidebar.classList.contains('collapsed')).toBe(true);
    expect(context.elements.sidebar.hidden).toBe(true);
  });

  it('opens the display name dialog and persists submitted names', () => {
    document.body.innerHTML = `
      <dialog id="display-name-dialog"></dialog>
      <input id="display-name-input">
      <h2 id="display-name-title"></h2>
      <p id="display-name-copy"></p>
      <button id="display-name-cancel"></button>
      <button id="display-name-submit"></button>
      <span id="current-user-name"></span>
      <button id="edit-name-button"></button>
    `;

    const dialog = document.getElementById('display-name-dialog');
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };

    const context = {
      _hasPromptedForDisplayName: false,
      elements: {
        currentUserName: document.getElementById('current-user-name'),
        displayNameCancel: document.getElementById('display-name-cancel'),
        displayNameCopy: document.getElementById('display-name-copy'),
        displayNameDialog: dialog,
        displayNameInput: document.getElementById('display-name-input'),
        displayNameSubmit: document.getElementById('display-name-submit'),
        displayNameTitle: document.getElementById('display-name-title'),
        editNameButton: document.getElementById('edit-name-button'),
      },
      excalidrawEmbed: { updateLocalUser: vi.fn() },
      globalUsers: [],
      getCurrentUser: () => ({ name: 'Alice' }),
      getCurrentUserName: () => 'Alice',
      getStoredUserName: () => '',
      isIdentityManagedByAuth: () => false,
      isTabActive: true,
      lobby: {
        getLocalUser: () => ({ name: 'Bob' }),
        setUserName: vi.fn(),
      },
      preferences: {
        getUserName: () => 'Bob',
        setUserName: vi.fn(),
      },
      renderChat: vi.fn(),
      session: {
        getLocalUser: () => ({ name: 'Bob' }),
        setUserName: () => 'Bob',
      },
      syncCurrentUserName: uiFeatureIdentityMethods.syncCurrentUserName,
      toastController: { show: vi.fn() },
    };

    Object.assign(context, uiFeatureIdentityMethods);

    context.openDisplayNameDialog({ mode: 'onboarding' });
    expect(dialog.open).toBe(true);
    expect(context.elements.displayNameSubmit.textContent).toBe('Continue');

    context.elements.displayNameInput.value = 'Bob';
    context.handleDisplayNameSubmit();

    expect(context.preferences.setUserName).toHaveBeenCalledWith('Bob');
    expect(context.lobby.setUserName).toHaveBeenCalledWith('Bob');
    expect(dialog.open).toBe(false);
  });

  it('dispatches markdown toolbar actions and image uploads through the toolbar helpers', async () => {
    document.body.innerHTML = '<div id="editor-container"></div><div id="markdown-toolbar"></div>';
    const context = {
      currentFilePath: 'README.md',
      elements: {
        editorContainer: document.getElementById('editor-container'),
        markdownToolbar: document.getElementById('markdown-toolbar'),
      },
      fileExplorer: { refresh: vi.fn(async () => {}) },
      handleToolbarImageInsert: uiFeatureToolbarMethods.handleToolbarImageInsert,
      pickImageFile: vi.fn(async () => null),
      session: {
        applyMarkdownToolbarAction: vi.fn(() => true),
        insertText: vi.fn(),
        runEditorCommand: vi.fn(() => true),
      },
      toastController: { show: vi.fn() },
      vaultApiClient: {
        uploadImageAttachment: vi.fn(async () => ({ markdown: '![img](image.png)', path: 'image.png' })),
      },
    };

    Object.assign(context, uiFeatureToolbarMethods);
    context.renderMarkdownToolbar();

    expect(document.querySelector('.markdown-toolbar-popover [data-markdown-block-action="paragraph"]')).not.toBeNull();
    expect(document.querySelector('.markdown-toolbar-popover [data-markdown-block-action="heading-6"]')).not.toBeNull();
    expect(document.querySelector('[data-editor-command="undo"]')).not.toBeNull();
    expect(document.querySelector('[data-editor-command="indentMore"]')).not.toBeNull();

    context.applyMarkdownToolbarAction('bold');
    expect(context.session.applyMarkdownToolbarAction).toHaveBeenCalledWith('bold');

    const undoButton = context.elements.markdownToolbar.querySelector('[data-editor-command="undo"]');
    context.handleMarkdownToolbarClick({ preventDefault() {}, target: undoButton });
    expect(context.session.runEditorCommand).toHaveBeenCalledWith('undo');

    const inserted = await context.handleEditorImageInsert(new File(['x'], 'image.png', { type: 'image/png' }));
    expect(inserted).toBe(true);
    expect(context.fileExplorer.refresh).toHaveBeenCalled();
    expect(context.session.insertText).toHaveBeenCalledWith('![img](image.png)');
  });

  it('opens the block menu and dispatches explicit heading actions from the rendered toolbar', () => {
    document.body.innerHTML = '<div id="editor-container"></div><div id="markdown-toolbar"></div>';

    const context = {
      currentFilePath: 'README.md',
      elements: {
        editorContainer: document.getElementById('editor-container'),
        markdownToolbar: document.getElementById('markdown-toolbar'),
      },
      session: {
        applyMarkdownToolbarAction: vi.fn(() => true),
        insertText: vi.fn(),
      },
      toastController: { show: vi.fn() },
    };

    Object.assign(context, uiFeatureToolbarMethods);
    context.renderMarkdownToolbar();

    const toggle = context.elements.markdownToolbar.querySelector('[data-markdown-block-menu-toggle]');
    context.handleMarkdownToolbarClick({ preventDefault() {}, target: toggle });
    expect(context.isMarkdownBlockMenuOpen()).toBe(true);
    expect(document.querySelector('.markdown-toolbar-popover')).not.toBeNull();

    const headingItem = document.querySelector('.markdown-toolbar-popover [data-markdown-block-action="heading-3"]');
    context.handleMarkdownToolbarClick({ preventDefault() {}, target: headingItem });

    expect(context.session.applyMarkdownToolbarAction).toHaveBeenCalledWith('heading-3');
    expect(context.elements.markdownToolbar.querySelector('[data-markdown-block-trigger-label]').textContent).toBe('H3');
    expect(context.isMarkdownBlockMenuOpen()).toBe(false);
  });

  it('toggles the mobile toolbar overflow menu state', () => {
    document.body.innerHTML = `
      <div class="toolbar-right">
        <button id="toolbar-overflow-toggle"></button>
        <div id="toolbar-overflow-menu"></div>
      </div>
    `;

    const context = {
      elements: {
        toolbarOverflowMenu: document.getElementById('toolbar-overflow-menu'),
        toolbarOverflowToggle: document.getElementById('toolbar-overflow-toggle'),
      },
      isMobileViewport: () => true,
    };

    Object.assign(context, uiFeatureShellMethods);

    context.toggleToolbarOverflowMenu();
    expect(context.toolbarOverflowOpen).toBe(true);
    expect(context.elements.toolbarOverflowToggle.getAttribute('aria-expanded')).toBe('true');
    expect(context.elements.toolbarOverflowToggle.closest('.toolbar-right').classList.contains('is-overflow-open')).toBe(true);

    context.closeToolbarOverflowMenu();
    expect(context.toolbarOverflowOpen).toBe(false);
    expect(context.elements.toolbarOverflowToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens quick switcher from the mobile overflow search files action', () => {
    document.body.innerHTML = '<button id="search-files"></button>';

    const context = {
      elements: {
        searchFilesButton: document.getElementById('search-files'),
      },
      toggleQuickSwitcher: vi.fn(async () => {}),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.closeToolbarOverflowMenu = vi.fn();
    context.bindEvents();

    context.elements.searchFilesButton.click();

    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(context.closeToolbarOverflowMenu).toHaveBeenCalledTimes(1);
  });

  it('opens editor search from the mobile find button', () => {
    document.body.innerHTML = '<button id="editor-find"></button>';

    const context = {
      elements: {
        editorFindButton: document.getElementById('editor-find'),
      },
      runEditorCommand: vi.fn(),
      toggleQuickSwitcher: vi.fn(async () => {}),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();

    context.elements.editorFindButton.click();

    expect(context.runEditorCommand).toHaveBeenCalledWith('openSearch');
  });

  it('syncs app shell viewport css vars from visualViewport metrics', () => {
    const context = {};

    Object.assign(context, uiFeatureShellMethods);

    const originalVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 512,
        offsetTop: 24,
      },
    });

    try {
      context.syncVisualViewportBounds();
      expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('512px');
      expect(document.documentElement.style.getPropertyValue('--app-viewport-offset-top')).toBe('24px');
    } finally {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: originalVisualViewport,
      });
      document.documentElement.style.removeProperty('--app-viewport-height');
      document.documentElement.style.removeProperty('--app-viewport-offset-top');
    }
  });

  it('binds global handlers for chat dismissal and keyboard shortcuts', () => {
    document.body.innerHTML = `
      <div id="chat-container"><button id="chat-inner"></button></div>
      <form id="chat-form"></form>
      <button id="chat-toggle"></button>
      <button id="chat-notification"></button>
      <button id="share-button"></button>
      <button id="file-history"></button>
      <button id="edit-name"></button>
      <button id="display-name-cancel"></button>
      <button id="git-commit-cancel"></button>
      <button id="git-reset-cancel"></button>
      <button id="git-reset-submit"></button>
      <dialog id="git-commit-dialog"></dialog>
      <dialog id="git-reset-dialog"></dialog>
      <div id="markdown-toolbar"></div>
      <form id="display-name-form"></form>
      <form id="git-commit-form"></form>
      <button id="tab-lock-takeover"></button>
      <button id="toggle-wrap"></button>
      <div id="preview-content"></div>
      <button id="sidebar-toggle"></button>
      <button id="sidebar-close"></button>
      <button id="files-tab"></button>
      <button id="git-tab"></button>
    `;

    const context = {
      chatIsOpen: true,
      closeChatPanel: vi.fn(),
      currentFilePath: 'README.md',
      elements: {
        chatContainer: document.getElementById('chat-container'),
        chatForm: document.getElementById('chat-form'),
        chatNotificationButton: document.getElementById('chat-notification'),
        chatToggleButton: document.getElementById('chat-toggle'),
        displayNameCancel: document.getElementById('display-name-cancel'),
        displayNameForm: document.getElementById('display-name-form'),
        editNameButton: document.getElementById('edit-name'),
        emptyStateNewFileBtn: null,
        emptyStateSearchBtn: null,
        fileHistoryButton: document.getElementById('file-history'),
        filesSidebarTab: document.getElementById('files-tab'),
        gitCommitCancel: document.getElementById('git-commit-cancel'),
        gitCommitDialog: document.getElementById('git-commit-dialog'),
        gitCommitForm: document.getElementById('git-commit-form'),
        gitCommitInput: document.createElement('input'),
        gitCommitSubmit: document.createElement('button'),
        gitResetCancel: document.getElementById('git-reset-cancel'),
        gitResetDialog: document.getElementById('git-reset-dialog'),
        gitResetFileName: document.createElement('input'),
        gitResetSubmit: document.getElementById('git-reset-submit'),
        gitSearch: document.createElement('div'),
        gitSidebarTab: document.getElementById('git-tab'),
        markdownToolbar: document.getElementById('markdown-toolbar'),
        previewContent: document.getElementById('preview-content'),
        shareButton: document.getElementById('share-button'),
        sidebarClose: document.getElementById('sidebar-close'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        tabLockTakeoverButton: document.getElementById('tab-lock-takeover'),
        toggleWrapButton: document.getElementById('toggle-wrap'),
      },
      gitRepoAvailable: true,
      handleChatNotificationToggle: vi.fn(),
      handleChatSubmit: vi.fn(),
      handleDisplayNameSubmit: vi.fn(),
      handleFileHistorySelection: vi.fn(),
      handleGitCommitSubmit: vi.fn(),
      handleGitFileHistorySelection: vi.fn(),
      handleGitResetSubmit: vi.fn(),
      handleHashChange: vi.fn(),
      handleTabTakeover: vi.fn(),
      handleToolbarImageInsert: vi.fn(),
      handleWikiLinkClick: vi.fn(),
      navigation: { getHashRoute: () => ({ type: 'empty' }) },
      openDisplayNameDialog: vi.fn(),
      setSidebarTab: vi.fn(),
      toggleChatPanel: vi.fn(),
      toggleLineWrapping: vi.fn(),
      toggleQuickSwitcher: vi.fn(async () => {}),
      toggleSidebar: vi.fn(),
      copyCurrentLink: vi.fn(async () => {}),
      closeSidebarOnMobile: vi.fn(),
      applyMarkdownToolbarAction: vi.fn(),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(context.closeChatPanel).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'k' }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'K' }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      code: 'KeyK',
      key: 'Unidentified',
      metaKey: true,
    }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(3);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'K',
      metaKey: true,
      shiftKey: true,
    }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(3);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      ctrlKey: true,
      key: 'k',
      repeat: true,
    }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(3);
  });

  it('resets the quick switcher loader after a lazy import failure', async () => {
    const loadError = new Error('chunk failed');
    class TestQuickSwitcher {
      constructor(options) {
        this.options = options;
      }
    }

    const context = {
      fileExplorer: { flatFiles: ['README.md'] },
      handleFileSelection: vi.fn(),
      loadQuickSwitcherController: vi.fn()
        .mockRejectedValueOnce(loadError)
        .mockResolvedValueOnce(TestQuickSwitcher),
      quickSwitcher: null,
      quickSwitcherModulePromise: null,
      toastController: { show: vi.fn() },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(ensureQuickSwitcherInstance(context)).rejects.toThrow('chunk failed');

    expect(context.quickSwitcherModulePromise).toBeNull();
    expect(context.toastController.show).toHaveBeenCalledWith('Failed to load file search. Try again.', {
      dismissible: true,
    });
    expect(consoleError).toHaveBeenCalled();

    const quickSwitcher = await ensureQuickSwitcherInstance(context);

    expect(context.loadQuickSwitcherController).toHaveBeenCalledTimes(2);
    expect(quickSwitcher).toBeInstanceOf(TestQuickSwitcher);
    expect(quickSwitcher.options.getFileList()).toEqual(['README.md']);
    quickSwitcher.options.onFileSelect('docs/guide.md');
    expect(context.handleFileSelection).toHaveBeenCalledWith('docs/guide.md', {
      closeSidebarOnMobile: true,
      revealInTree: true,
    });
  });

  it('toggles preview task items from preview clicks without hijacking wiki links', () => {
    document.body.innerHTML = `
      <div id="preview-content">
        <ul>
          <li class="task-list-item" data-source-line="7">
            <input type="checkbox" data-task-checkbox="true">
            First todo
          </li>
          <li class="task-list-item" data-source-line="8">
            <input type="checkbox" data-task-checkbox="true">
            Read <a href="https://example.com/docs">docs</a>
          </li>
        </ul>
        <a class="wiki-link" data-wiki-target="README" href="#README">README</a>
      </div>
    `;

    const context = {
      elements: {
        previewContent: document.getElementById('preview-content'),
      },
      handlePreviewContentClick: uiFeatureShellMethods.handlePreviewContentClick,
      handleWikiLinkClick: vi.fn(),
      session: {
        toggleTaskListItem: vi.fn(() => true),
      },
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();

    const checkbox = context.elements.previewContent.querySelector('input[type="checkbox"]');
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(context.session.toggleTaskListItem).toHaveBeenCalledWith(7);
    expect(checkbox.checked).toBe(false);

    const externalLink = context.elements.previewContent.querySelector('li[data-source-line="8"] a');
    const externalClick = {
      preventDefault: vi.fn(),
      target: externalLink,
    };
    context.handlePreviewContentClick(externalClick);

    expect(context.session.toggleTaskListItem).toHaveBeenCalledTimes(1);
    expect(externalClick.preventDefault).not.toHaveBeenCalled();

    const wikiLink = context.elements.previewContent.querySelector('a.wiki-link');
    wikiLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(context.handleWikiLinkClick).toHaveBeenCalledWith('README');
    expect(context.session.toggleTaskListItem).toHaveBeenCalledTimes(1);
  });
});
