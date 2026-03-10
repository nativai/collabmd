import {
  isDiagramFilePath,
  isExcalidrawFilePath,
  isMarkdownFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
  stripVaultFileExtension,
} from '../../../domain/file-kind.js';
import { resolveWikiTarget } from '../../domain/vault-utils.js';

export const workspaceFeature = {
  isExcalidrawFile(filePath) {
    return isExcalidrawFilePath(filePath);
  },

  isMermaidFile(filePath) {
    return isMermaidFilePath(filePath);
  },

  isPlantUmlFile(filePath) {
    return isPlantUmlFilePath(filePath);
  },

  createDiagramPreviewDocument(language, source = '') {
    const text = String(source ?? '');
    const longestFence = Math.max(...(text.match(/`+/g)?.map((fence) => fence.length) ?? [0]));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    return `${fence}${language}\n${text}\n${fence}`;
  },

  getPreviewSource() {
    const source = this.session?.getText() ?? '';
    if (this.isMermaidFile(this.currentFilePath)) {
      return this.createDiagramPreviewDocument('mermaid', source);
    }

    if (this.isPlantUmlFile(this.currentFilePath)) {
      return this.createDiagramPreviewDocument('plantuml', source);
    }

    return source;
  },

  getDisplayName(filePath) {
    return stripVaultFileExtension(String(filePath ?? '')
      .split('/')
      .pop());
  },

  resetPreviewMode() {
    this.elements.previewContent?.classList.remove('is-excalidraw-file-preview');
    this.elements.previewContent?.classList.remove('is-mermaid-file-preview');
    this.elements.previewContent?.classList.remove('is-plantuml-file-preview');
  },

  syncFileChrome(filePath) {
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isMarkdown = isMarkdownFilePath(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const isDiagramFile = isDiagramFilePath(filePath);
    this.elements.markdownToolbar?.classList.toggle('hidden', !isMarkdown);
    this.elements.outlineToggle?.classList.toggle('hidden', isDiagramFile);
    this.elements.commentsToggle?.classList.toggle('hidden', isDiagramFile);
    this.elements.commentSelectionButton?.classList.toggle('hidden', isDiagramFile);
    this.elements.previewContent?.classList.toggle('is-mermaid-file-preview', isMermaid);
    this.elements.previewContent?.classList.toggle('is-plantuml-file-preview', isPlantUml);

    if (isExcalidraw) {
      this.layoutController.setView('preview');
      this.outlineController.close();
      this.backlinksPanel.clear();
      return;
    }

    if (isMermaid || isPlantUml) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }
  },

  renderExcalidrawFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-excalidraw-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const placeholder = document.createElement('div');
    placeholder.className = 'excalidraw-embed-placeholder';
    placeholder.dataset.embedKey = `${filePath}#file-preview`;
    placeholder.dataset.embedLabel = this.getDisplayName(filePath);
    placeholder.dataset.embedTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading Excalidraw preview…';
    placeholder.appendChild(loadingShell);
    if (renderHost) {
      renderHost.replaceChildren(placeholder);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.excalidrawEmbed.reconcileEmbeds(previewElement, { isLargeDocument: false });
    this.excalidrawEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSync({ delayMs: 0 });
  },

  createResizeHandler() {
    let resizeTimer = null;
    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.restoreSidebarState();
        this.schedulePreviewLayoutSync({ delayMs: 0 });
      }, 100);
    };
  },

  initializePreviewLayoutObserver() {
    if (typeof ResizeObserver !== 'function' || !this.elements.previewContent) {
      return;
    }

    this._previewLayoutResizeObserver?.disconnect();
    this._previewLayoutResizeObserver = new ResizeObserver(() => {
      this.schedulePreviewLayoutSync();
    });
    this._previewLayoutResizeObserver.observe(this.elements.previewContent);
  },

  schedulePreviewLayoutSync({ delayMs = 120 } = {}) {
    if (this._previewHydrationPaused) {
      this._pendingPreviewLayoutSync = true;
      return;
    }

    clearTimeout(this._previewLayoutSyncTimer);

    this._previewLayoutSyncTimer = setTimeout(() => {
      this._previewLayoutSyncTimer = null;

      if (!this.session || !this.elements.previewContent) {
        return;
      }

      if (this.elements.previewContent.dataset.renderPhase === 'shell') {
        return;
      }

      if (this._previewHydrationPaused) {
        this._pendingPreviewLayoutSync = true;
        return;
      }

      this.excalidrawEmbed.syncLayout();
      this.scrollSyncController.invalidatePreviewBlocks();
      this.scrollSyncController.warmPreviewBlocks({
        onReady: () => {
          if (!this.session) {
            return;
          }

          this.scrollSyncController.realignAfterLayoutChange();
          this.outlineController.scheduleActiveHeadingUpdate();
        },
      });
    }, delayMs);
  },

  handleEditorScrollActivityChange(isActive) {
    this._previewHydrationPaused = Boolean(isActive);
    this.previewRenderer.setHydrationPaused(this._previewHydrationPaused);
    this.excalidrawEmbed.setHydrationPaused(this._previewHydrationPaused);

    if (this._previewHydrationPaused) {
      clearTimeout(this._previewLayoutSyncTimer);
      this._previewLayoutSyncTimer = null;
      this._pendingPreviewLayoutSync = true;
      return;
    }

    if (this._pendingPreviewLayoutSync) {
      this._pendingPreviewLayoutSync = false;
      this.schedulePreviewLayoutSync({ delayMs: 0 });
    }
  },

  async handleHashChange() {
    if (!this.isTabActive) {
      return;
    }

    const route = this.navigation.getHashRoute();
    if (route.type === 'empty') {
      this.gitPanel.setSelection();
      this.showEmptyState();
      this.syncMainChrome({ mode: 'empty', title: 'CollabMD' });
      return;
    }

    if (route.type === 'git-diff') {
      this.setSidebarTab('git');
      await this.showGitDiff(route);
      return;
    }

    this.setSidebarTab('files');
    await this.openFile(route.filePath);
  },

  showEmptyState() {
    this.gitDiffView.hide();
    this.workspaceCoordinator.cleanupSession();
    this.session = null;
    this.sessionLoadToken += 1;
    this.clearInitialFileBootstrap();
    this.resetPreviewMode();
    this.elements.outlineToggle?.classList.remove('hidden');
    this.elements.commentsToggle?.classList.add('hidden');
    this.elements.commentSelectionButton?.classList.add('hidden');
    this.elements.markdownToolbar?.classList.add('hidden');
    this.currentFilePath = null;
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.add('hidden');
    this.elements.previewContent.innerHTML = '';
    this.elements.previewContent.dataset.renderPhase = 'ready';
    clearTimeout(this._previewLayoutSyncTimer);
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this.previewRenderer.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
    this.updateCommentThreads([]);
    this.commentsPanel.setCurrentFile(null, { supported: false });

    if (this.elements.activeFileName) {
      this.elements.activeFileName.textContent = 'CollabMD';
    }
  },

  showDiffState() {
    this.sessionLoadToken += 1;
    this.clearInitialFileBootstrap();
    this.workspaceCoordinator.cleanupSession();
    this.session = null;
    this.resetPreviewMode();
    this.layoutController.reset();
    this.currentFilePath = null;
    this.lobby.setCurrentFile(null);
    this.fileExplorer.setActiveFile(null);

    this.elements.emptyState?.classList.add('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.diffPage?.classList.remove('hidden');
    this.elements.previewContent.innerHTML = '';
    this.elements.previewContent.dataset.renderPhase = 'ready';
    clearTimeout(this._previewLayoutSyncTimer);
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this.previewRenderer.setHydrationPaused(false);
    this.excalidrawEmbed.setHydrationPaused(false);
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();

    this.elements.outlineToggle?.classList.add('hidden');
    this.elements.commentsToggle?.classList.add('hidden');
    this.elements.commentSelectionButton?.classList.add('hidden');
    this.elements.markdownToolbar?.classList.add('hidden');

    this.renderAvatars();
    this.renderPresence();
    this.backlinksPanel.clear();
    this.updateCommentThreads([]);
    this.commentsPanel.setCurrentFile(null, { supported: false });
  },

  async openFile(filePath) {
    this.gitPanel.setSelection();
    this.gitDiffView.hide();
    this.syncMainChrome({ mode: 'editor' });
    await this.workspaceCoordinator.openFile(filePath);
    this.session = this.workspaceCoordinator.getSession();
  },

  cleanupSession() {
    this.workspaceCoordinator.cleanupSession();
    this.session = this.workspaceCoordinator.getSession();
  },

  handleWikiLinkClick(target) {
    const files = this.fileExplorer.flatFiles;
    const match = resolveWikiTarget(target, files);

    if (match) {
      this.navigation.navigateToFile(match);
    } else {
      const normalizedPath = this.normalizeNewWikiFilePath(target);
      if (!normalizedPath) {
        this.toastController.show('Cannot create an empty wiki-link target');
        return;
      }
      this.createAndOpenFile(normalizedPath, target);
    }
  },

  normalizeNewWikiFilePath(target) {
    const normalized = String(target ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');

    if (!normalized) {
      return null;
    }

    return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  },

  async createAndOpenFile(filePath, displayName) {
    try {
      const response = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: `# ${displayName}\n\n` }),
      });
      const data = await response.json();
      if (data.ok) {
        await this.fileExplorer.refresh();
        this.navigation.navigateToFile(filePath);
        this.toastController.show(`Created ${displayName}`);
      } else {
        this.toastController.show(data.error || 'Failed to create file');
      }
    } catch (error) {
      this.toastController.show(`Failed to create file: ${error.message}`);
    }
  },

  handleFileSelection(filePath, { closeSidebarOnMobile = false } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }
    this.navigation.navigateToFile(filePath);
  },
};
