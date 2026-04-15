import { createDrawioLeaseRoomName } from '../../domain/drawio-room.js';
import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import { resolveAppUrl } from '../domain/runtime-paths.js';
import { vaultApiClient } from '../domain/vault-api-client.js';

const HYDRATE_VIEWPORT_MARGIN_PX = 360;
const DRAWIO_VIEWER_SCRIPT_URL = 'https://viewer.diagrams.net/js/viewer-static.min.js';

let drawioViewerLoadPromise = null;

function requestIdleRender(callback, timeout) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1);
}

function cancelIdleRender(id) {
  if (id === null) {
    return;
  }

  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(id);
    return;
  }

  window.clearTimeout(id);
}

function isNearViewport(element, root, marginPx) {
  if (!element || !root) {
    return false;
  }

  const rootRect = root.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return elementRect.bottom >= (rootRect.top - marginPx) && elementRect.top <= (rootRect.bottom + marginPx);
}

function ensureDrawioViewerLoaded() {
  if (window.GraphViewer?.processElements) {
    return Promise.resolve(window.GraphViewer);
  }

  if (drawioViewerLoadPromise) {
    return drawioViewerLoadPromise;
  }

  drawioViewerLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-collabmd-drawio-viewer]');
    const script = existingScript instanceof HTMLScriptElement
      ? existingScript
      : document.createElement('script');

    const cleanup = () => {
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
    };

    const handleError = () => {
      cleanup();
      drawioViewerLoadPromise = null;
      reject(new Error('Failed to load draw.io viewer'));
    };

    const handleLoad = () => {
      cleanup();
      if (!window.GraphViewer?.processElements) {
        drawioViewerLoadPromise = null;
        reject(new Error('draw.io viewer did not initialize'));
        return;
      }

      resolve(window.GraphViewer);
    };

    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });

    if (!existingScript) {
      script.src = DRAWIO_VIEWER_SCRIPT_URL;
      script.async = true;
      script.dataset.collabmdDrawioViewer = 'true';
      document.head.append(script);
    } else if (window.GraphViewer?.processElements) {
      handleLoad();
    }
  });

  return drawioViewerLoadPromise;
}

export class DrawioEmbedController {
  constructor({
    getLocalUser,
    getTheme,
    onOpenFile = null,
    onOpenTextFile = null,
    onToggleQuickSwitcher = null,
    previewContainer,
    previewElement,
    toastController,
  }) {
    this.getLocalUser = getLocalUser;
    this.getTheme = getTheme;
    this.onOpenFile = onOpenFile;
    this.onOpenTextFile = onOpenTextFile;
    this.onToggleQuickSwitcher = onToggleQuickSwitcher;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.embedEntries = new Map();
    this.hydrationQueue = [];
    this.hydrationIdleId = null;
    this.hydrationPaused = false;
    this.instanceCounter = 0;
    this.maximizedEntry = null;
    this.maximizedRoot = null;

    this._onMessage = this._onMessage.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);

    window.addEventListener('message', this._onMessage);
    window.addEventListener('keydown', this._onKeyDown);
    this.previewElement?.addEventListener('click', this._onPreviewClick);
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    window.removeEventListener('keydown', this._onKeyDown);
    this.previewElement?.removeEventListener('click', this._onPreviewClick);
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this._exitMaximizedEntry();
    document.body.classList.remove('drawio-maximized-open');
    this.embedEntries.forEach((entry) => entry.wrapper?.remove());
    this.embedEntries.clear();
    this.maximizedRoot?.remove();
    this.maximizedRoot = null;
  }

  detachForCommit() {
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.embedEntries.forEach((entry) => {
      entry.placeholder = null;
    });
  }

  setHydrationPaused(paused) {
    this.hydrationPaused = Boolean(paused);
    if (!this.hydrationPaused) {
      this.hydrateVisibleEmbeds();
    }
  }

  reconcileEmbeds(previewElement) {
    this._exitMaximizedEntry();

    const descriptors = Array.from(previewElement.querySelectorAll('.drawio-embed-placeholder[data-drawio-key]')).map((placeholder) => ({
      filePath: placeholder.dataset.drawioTarget || '',
      key: placeholder.dataset.drawioKey || '',
      label: placeholder.dataset.drawioLabel || placeholder.dataset.drawioTarget || '',
      mode: placeholder.dataset.drawioMode === 'edit' ? 'edit' : 'view',
      placeholder,
    }));

    const nextEntries = new Map();
    descriptors.forEach((descriptor) => {
      const existingEntry = this.embedEntries.get(descriptor.key) || null;
      const nextEntry = existingEntry
        ? { ...existingEntry, ...descriptor }
        : {
          ...descriptor,
          iframe: null,
          imageElement: null,
          instanceId: '',
          queued: false,
          viewerElement: null,
          wrapper: null,
        };
      nextEntries.set(descriptor.key, nextEntry);
    });

    this.embedEntries.forEach((entry, key) => {
      if (!nextEntries.has(key)) {
        entry.wrapper?.remove();
      }
    });

    this.embedEntries = nextEntries;

    this.embedEntries.forEach((entry) => {
      if (entry.wrapper) {
        entry.placeholder?.replaceWith(entry.wrapper);
      } else {
        entry.queued = false;
      }
    });

    if (!this.hydrationPaused) {
      this.hydrateVisibleEmbeds();
    }
  }

  hydrateVisibleEmbeds() {
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper || !entry.placeholder?.isConnected) {
        return;
      }

      if (entry.mode === 'edit' || isNearViewport(entry.placeholder, this.previewContainer, HYDRATE_VIEWPORT_MARGIN_PX)) {
        this.enqueueHydration(entry);
      }
    });
  }

  enqueueHydration(entry) {
    if (entry.queued) {
      return;
    }

    entry.queued = true;
    this.hydrationQueue.push(entry);
    if (this.hydrationIdleId !== null) {
      return;
    }

    this.hydrationIdleId = requestIdleRender(() => {
      this.hydrationIdleId = null;
      const nextQueue = this.hydrationQueue.splice(0);
      nextQueue.forEach((queuedEntry) => {
        queuedEntry.queued = false;
        this.hydrateEntry(queuedEntry);
      });
    }, 200);
  }

  hydrateEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    if (entry.mode === 'view') {
      void this.hydrateViewerEntry(entry);
      return;
    }

    this.hydrateIframeEntry(entry);
  }

  hydrateIframeEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `drawio-embed diagram-preview-shell${entry.mode === 'edit' ? ' is-direct-file' : ''}`;
    wrapper.dataset.file = entry.filePath;
    wrapper.dataset.drawioKey = entry.key;

    const header = document.createElement('div');
    header.className = 'drawio-embed-header diagram-preview-toolbar';

    const icon = document.createElement('span');
    icon.className = 'drawio-embed-icon';
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';

    const label = document.createElement('span');
    label.className = 'drawio-embed-label';
    label.textContent = entry.label.replace(/\.drawio$/i, '');
    header.append(icon, label);

    if (entry.mode !== 'edit') {
      header.appendChild(this.createOpenButton(entry));
    }

    header.appendChild(this.createMaximizeButton(entry, wrapper));

    const iframe = document.createElement('iframe');
    iframe.className = 'drawio-embed-iframe';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    entry.instanceId = `drawio-${++this.instanceCounter}`;
    iframe.dataset.instanceId = entry.instanceId;
    iframe.src = this.buildIframeUrl(entry);

    wrapper.append(header, iframe);
    entry.iframe = iframe;
    entry.wrapper = wrapper;
    entry.placeholder.replaceWith(wrapper);
  }

  async hydrateViewerEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'drawio-embed diagram-preview-shell is-static-preview';
    wrapper.dataset.file = entry.filePath;
    wrapper.dataset.drawioKey = entry.key;

    const header = document.createElement('div');
    header.className = 'drawio-embed-header diagram-preview-toolbar';

    const icon = document.createElement('span');
    icon.className = 'drawio-embed-icon';
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';

    const label = document.createElement('span');
    label.className = 'drawio-embed-label';
    label.textContent = entry.label.replace(/\.drawio$/i, '');
    header.append(icon, label);

    header.append(this.createOpenButton(entry), this.createMaximizeButton(entry, wrapper));

    const viewerShell = document.createElement('div');
    viewerShell.className = 'drawio-viewer-shell';
    viewerShell.dataset.filePath = entry.filePath;

    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Rendering draw.io preview…';
    viewerShell.appendChild(loadingShell);

    wrapper.append(header, viewerShell);
    entry.iframe = null;
    entry.wrapper = wrapper;
    entry.viewerElement = viewerShell;
    entry.placeholder.replaceWith(wrapper);

    try {
      await this.renderViewerEntry(entry);
    } catch (error) {
      this.renderViewerFallback(entry, error instanceof Error ? error.message : 'Failed to render draw.io preview');
    }
  }

  async renderViewerEntry(entry) {
    const [{ content }, viewer] = await Promise.all([
      vaultApiClient.readFile(entry.filePath),
      ensureDrawioViewerLoaded(),
    ]);

    if (!entry.wrapper?.isConnected || !entry.viewerElement?.isConnected) {
      return;
    }

    const theme = this.getTheme?.() === 'light' ? 'light' : 'dark';
    const graphElement = document.createElement('div');
    graphElement.className = 'mxgraph drawio-viewer-frame';
    graphElement.dataset.action = 'open-file';
    graphElement.dataset.filePath = entry.filePath;
    graphElement.setAttribute('role', 'button');
    graphElement.setAttribute('tabindex', '0');
    graphElement.setAttribute('aria-label', `Open ${entry.label.replace(/\.drawio$/i, '')}`);
    graphElement.addEventListener('click', (event) => {
      event.preventDefault();
      this.onOpenFile?.(entry.filePath);
    });
    graphElement.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      this.onOpenFile?.(entry.filePath);
    });
    graphElement.dataset.mxgraph = JSON.stringify({
      'check-visible-state': false,
      center: true,
      border: 0,
      'dark-mode': theme,
      editable: false,
      fit: 1,
      lightbox: false,
      nav: false,
      resize: false,
      toolbar: '',
      tooltips: false,
      xml: String(content ?? ''),
    });

    entry.viewerElement.replaceChildren(graphElement);
    entry.viewerElement = graphElement;
    viewer.processElements();
  }

  buildIframeUrl(entry) {
    const url = new URL(resolveAppUrl('/drawio-editor.html'));
    const localUser = this.getLocalUser?.() ?? {};
    url.searchParams.set('file', entry.filePath);
    url.searchParams.set('hostMode', entry.mode === 'edit' ? 'file-preview' : 'embed');
    url.searchParams.set('instanceId', entry.instanceId);
    url.searchParams.set('mode', entry.mode === 'edit' ? 'edit' : 'view');
    url.searchParams.set('theme', this.getTheme?.() === 'light' ? 'light' : 'dark');

    if (localUser.name) {
      url.searchParams.set('userName', localUser.name);
    }
    if (localUser.peerId) {
      url.searchParams.set('peerId', localUser.peerId);
    }

    if (entry.mode === 'edit') {
      url.searchParams.set('leaseRoom', createDrawioLeaseRoomName(entry.filePath));
    }

    return url.toString();
  }

  updateTheme(theme) {
    this.embedEntries.forEach((entry) => {
      if (entry.iframe?.contentWindow) {
        entry.iframe.contentWindow.postMessage({
          source: 'collabmd-host',
          theme,
          type: 'set-theme',
        }, window.location.origin);
      }

      if (entry.mode === 'view' && entry.wrapper?.isConnected && entry.viewerElement?.isConnected) {
        void this.renderViewerEntry(entry).catch((error) => {
          this.renderViewerFallback(entry, error instanceof Error ? error.message : 'Failed to render draw.io preview');
        });
      }
    });
  }

  updateLocalUser() {}

  syncLayout() {}

  createOpenButton(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drawio-embed-btn ui-preview-action ui-preview-action--icon-only';
    button.dataset.action = 'open-file';
    button.dataset.filePath = entry.filePath;
    button.title = 'Edit in draw.io';
    button.setAttribute('aria-label', 'Edit in draw.io');
    setDiagramActionButtonIcon(button, 'edit');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      this.onOpenFile?.(entry.filePath);
    });
    return button;
  }

  createMaximizeButton(entry, wrapper) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drawio-embed-btn ui-preview-action ui-preview-action--icon-only';
    button.dataset.action = 'toggle-maximize';
    button.dataset.filePath = entry.filePath;
    button.dataset.drawioKey = entry.key;

    const syncState = () => {
      const isMaximized = this.maximizedEntry?.key === entry.key;
      setDiagramActionButtonIcon(button, isMaximized ? 'restore' : 'maximize');
      button.title = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      button.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.maximizedEntry?.key === entry.key) {
        this._exitMaximizedEntry();
      } else {
        this._enterMaximizedEntry(entry, wrapper);
      }
      this._syncMaximizeButtons();
    });

    syncState();
    return button;
  }

  _ensureMaximizedRoot() {
    if (this.maximizedRoot?.isConnected && this.maximizedRoot.parentElement === document.body) {
      return this.maximizedRoot;
    }

    let maximizedRoot = document.body.querySelector('[data-drawio-maximized-root="true"]');
    if (!maximizedRoot) {
      maximizedRoot = document.createElement('div');
      maximizedRoot.dataset.drawioMaximizedRoot = 'true';
      maximizedRoot.className = 'drawio-maximized-root';
      document.body.appendChild(maximizedRoot);
    }

    this.maximizedRoot = maximizedRoot;
    return maximizedRoot;
  }

  _enterMaximizedEntry(entry, wrapper = entry?.wrapper) {
    if (!entry?.wrapper || entry.wrapper !== wrapper) {
      return;
    }

    if (this.maximizedEntry?.key === entry.key) {
      return;
    }

    this._exitMaximizedEntry();

    const maximizedRoot = this._ensureMaximizedRoot();
    const parent = entry.wrapper.parentElement;
    if (!parent) {
      return;
    }

    const spacer = document.createElement('div');
    spacer.className = 'drawio-maximize-spacer';
    spacer.style.height = `${Math.ceil(entry.wrapper.getBoundingClientRect().height)}px`;

    entry.maximizeSpacer = spacer;
    entry.restoreParent = parent;
    entry.restoreNextSibling = entry.wrapper.nextSibling || null;
    parent.insertBefore(spacer, entry.wrapper);

    maximizedRoot.hidden = false;
    maximizedRoot.appendChild(entry.wrapper);
    entry.wrapper.classList.add('is-maximized');
    document.body.classList.add('drawio-maximized-open');
    this.maximizedEntry = entry;
  }

  _exitMaximizedEntry() {
    const entry = this.maximizedEntry;
    if (!entry?.wrapper) {
      this.maximizedEntry = null;
      document.body.classList.remove('drawio-maximized-open');
      return;
    }

    const { maximizeSpacer, restoreNextSibling, restoreParent } = entry;
    entry.wrapper.classList.remove('is-maximized');

    if (maximizeSpacer?.parentElement) {
      maximizeSpacer.replaceWith(entry.wrapper);
    } else if (restoreParent?.isConnected) {
      if (restoreNextSibling?.parentElement === restoreParent) {
        restoreParent.insertBefore(entry.wrapper, restoreNextSibling);
      } else {
        restoreParent.appendChild(entry.wrapper);
      }
    }

    entry.maximizeSpacer = null;
    entry.restoreParent = null;
    entry.restoreNextSibling = null;
    this.maximizedEntry = null;
    document.body.classList.remove('drawio-maximized-open');
    if (this.maximizedRoot && this.maximizedRoot.childElementCount === 0) {
      this.maximizedRoot.hidden = true;
    }
  }

  _syncMaximizeButtons() {
    this.embedEntries.forEach((entry) => {
      const button = entry.wrapper?.querySelector('.drawio-embed-btn[data-action="toggle-maximize"]');
      if (!(button instanceof HTMLElement)) {
        return;
      }

      const isMaximized = this.maximizedEntry?.key === entry.key;
      setDiagramActionButtonIcon(button, isMaximized ? 'restore' : 'maximize');
      button.title = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      button.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    });
  }

  _findEntryByInstanceId(instanceId) {
    for (const entry of this.embedEntries.values()) {
      if (entry.instanceId === instanceId) {
        return entry;
      }
    }

    return null;
  }

  _isMessageFromEntry(event, entry) {
    return Boolean(entry?.iframe?.contentWindow && event.source === entry.iframe.contentWindow);
  }

  _onMessage(event) {
    if (event.origin !== window.location.origin) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.source !== 'drawio-editor') {
      return;
    }

    const entry = this._findEntryByInstanceId(payload.instanceId);
    if (!entry) {
      return;
    }
    if (!this._isMessageFromEntry(event, entry)) {
      return;
    }

    if (payload.type === 'fallback-text') {
      if (entry.mode === 'view') {
        this.renderViewerFallback(entry, 'Failed to render draw.io preview');
        return;
      }
      this.onOpenTextFile?.(entry.filePath);
      return;
    }

    if (payload.type === 'error') {
      if (entry.mode === 'view') {
        this.renderViewerFallback(entry, payload.message || 'Failed to load draw.io preview');
        return;
      }
      this.toastController?.show?.(payload.message || 'Failed to load draw.io');
      return;
    }

    if (payload.type === 'request-open-file') {
      this.onOpenFile?.(entry.filePath);
      return;
    }

    if (payload.type === 'request-toggle-quick-switcher') {
      this.onToggleQuickSwitcher?.();
    }
  }

  _onPreviewClick(event) {
    const loadButton = event.target.closest('.drawio-embed-placeholder-btn');
    if (loadButton) {
      const placeholder = loadButton.closest('.drawio-embed-placeholder');
      const key = placeholder?.dataset.drawioKey || '';
      const entry = this.embedEntries.get(key);
      if (entry) {
        event.preventDefault();
        this.hydrateEntry(entry);
      }
      return;
    }
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this._exitMaximizedEntry();
      this._syncMaximizeButtons();
    }
  }

  renderViewerFallback(entry, message) {
    if (!entry.wrapper) {
      return;
    }

    const viewerShell = entry.wrapper.querySelector('.drawio-viewer-shell, .drawio-viewer-frame');
    if (!viewerShell) {
      return;
    }

    const fallback = document.createElement('div');
    fallback.className = 'preview-shell';
    fallback.textContent = message;
    viewerShell.replaceChildren(fallback);
    entry.viewerElement = fallback;
  }
}
