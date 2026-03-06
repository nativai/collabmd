import { reconcileEmbedEntries } from './excalidraw-embed-reconciler.js';

const DEFAULT_HEIGHT = 420;
const HYDRATE_TIMEOUT_MS = 500;
const MAX_HEIGHT = 800;
const MIN_HEIGHT = 200;

function requestIdleRender(callback, timeout) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, 1);
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

  return (
    elementRect.bottom >= (rootRect.top - marginPx)
    && elementRect.top <= (rootRect.bottom + marginPx)
  );
}

export class ExcalidrawEmbedController {
  constructor({ getTheme, getLocalUser, previewContainer, previewElement, toastController }) {
    this.getTheme = getTheme;
    this.getLocalUser = getLocalUser;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.embedEntries = new Map();
    this.hydrationQueue = [];
    this.hydrationIdleId = null;
    this.hydrationInProgress = false;
    this.instanceCounter = 0;
    this.isLargeDocument = false;
    this.maximizedEmbed = null;
    this.placeholderObserver = null;

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
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this._exitMaximizedEmbed();
    document.body.classList.remove('excalidraw-maximized-open');

    this.embedEntries.forEach((entry) => {
      entry.wrapper?.remove();
      entry.placeholder = null;
    });
    this.embedEntries.clear();
  }

  detachForCommit() {
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.hydrationInProgress = false;

    this.embedEntries.forEach((entry) => {
      entry.queued = false;
      entry.placeholder = null;
      if (entry.wrapper?.isConnected) {
        entry.wrapper.remove();
      }
    });
  }

  reconcileEmbeds(previewElement, { isLargeDocument = false } = {}) {
    this.isLargeDocument = Boolean(isLargeDocument);
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.hydrationInProgress = false;

    const descriptors = Array.from(previewElement.querySelectorAll('.excalidraw-embed-placeholder[data-embed-key]')).map((placeholder) => ({
      filePath: placeholder.dataset.embedTarget,
      key: placeholder.dataset.embedKey,
      label: placeholder.dataset.embedLabel || placeholder.dataset.embedTarget,
      placeholder,
    }));

    const { nextEntries, removedEntries } = reconcileEmbedEntries(this.embedEntries, descriptors);
    removedEntries.forEach((entry) => this._destroyEntry(entry));
    this.embedEntries = nextEntries;

    this._ensurePlaceholderObserver();

    this.embedEntries.forEach((entry) => {
      entry.queued = false;
      if (entry.wrapper) {
        this._updateEmbedLabel(entry);
        this._attachWrapper(entry);
        return;
      }

      if (!entry.placeholder) {
        return;
      }

      this.placeholderObserver?.observe(entry.placeholder);
    });

    this.hydrateVisibleEmbeds();
  }

  hydrateVisibleEmbeds() {
    const margin = this.isLargeDocument ? 180 : 420;
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper || !entry.placeholder?.isConnected) {
        return;
      }

      if (isNearViewport(entry.placeholder, this.previewContainer, margin)) {
        this._enqueueHydration(entry, { prioritize: true });
      }
    });
  }

  updateTheme(theme) {
    this.embedEntries.forEach((entry) => {
      entry.iframe?.contentWindow?.postMessage({
        source: 'collabmd-host',
        type: 'set-theme',
        theme,
      }, window.location.origin);
    });
  }

  _ensurePlaceholderObserver() {
    if (!this.previewContainer) {
      return;
    }

    this.placeholderObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const embedEntry = this.embedEntries.get(entry.target.dataset.embedKey);
        if (embedEntry) {
          this._enqueueHydration(embedEntry);
        }
      });
    }, {
      root: this.previewContainer,
      rootMargin: this.isLargeDocument ? '180px 0px' : '420px 0px',
    });
  }

  _disconnectPlaceholderObserver() {
    if (!this.placeholderObserver) {
      return;
    }

    this.placeholderObserver.disconnect();
    this.placeholderObserver = null;
  }

  _enqueueHydration(entry, { prioritize = false } = {}) {
    if (!entry || entry.wrapper || entry.queued) {
      return;
    }

    entry.queued = true;
    if (prioritize) {
      this.hydrationQueue.unshift(entry.key);
    } else {
      this.hydrationQueue.push(entry.key);
    }

    this._scheduleHydration();
  }

  _scheduleHydration() {
    if (this.hydrationInProgress || this.hydrationIdleId !== null) {
      return;
    }

    this.hydrationIdleId = requestIdleRender(() => {
      this.hydrationIdleId = null;
      void this._flushHydrationQueue();
    }, HYDRATE_TIMEOUT_MS);
  }

  async _flushHydrationQueue() {
    if (this.hydrationInProgress) {
      return;
    }

    let nextEntry = null;
    while (this.hydrationQueue.length > 0 && !nextEntry) {
      const key = this.hydrationQueue.shift();
      const entry = this.embedEntries.get(key);
      if (!entry || entry.wrapper || !entry.placeholder?.isConnected) {
        if (entry) {
          entry.queued = false;
        }
        continue;
      }

      nextEntry = entry;
    }

    if (!nextEntry) {
      return;
    }

    this.hydrationInProgress = true;
    nextEntry.queued = false;

    await this._hydrateEntry(nextEntry);

    this.hydrationInProgress = false;
    if (this.hydrationQueue.length > 0) {
      this._scheduleHydration();
    }
  }

  async _hydrateEntry(entry) {
    if (!entry.placeholder?.isConnected && !entry.wrapper) {
      return;
    }

    if (!entry.wrapper) {
      const mount = this._createEmbedContainer(entry);
      entry.wrapper = mount.wrapper;
      entry.iframe = mount.iframe;
      entry.labelElement = mount.labelElement;
      entry.instanceId = mount.instanceId;
    }

    this._updateEmbedLabel(entry);
    this._attachWrapper(entry);
  }

  _attachWrapper(entry) {
    if (entry.wrapper?.isConnected) {
      return;
    }

    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.previewElement?.querySelector(`.excalidraw-embed-placeholder[data-embed-key="${entry.key}"]`);

    if (!placeholder) {
      return;
    }

    entry.placeholder = placeholder;
    placeholder.replaceWith(entry.wrapper);
    entry.placeholder = null;
  }

  _destroyEntry(entry) {
    if (this.maximizedEmbed?.wrapper === entry.wrapper) {
      this._exitMaximizedEmbed();
    }

    entry.wrapper?.remove();
    entry.placeholder = null;
  }

  _updateEmbedLabel(entry) {
    if (entry.labelElement) {
      entry.labelElement.textContent = entry.label.replace(/\.excalidraw$/i, '');
    }
  }

  _createEmbedContainer(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'excalidraw-embed';
    wrapper.dataset.embedKey = entry.key;
    wrapper.dataset.file = entry.filePath;

    const header = document.createElement('div');
    header.className = 'excalidraw-embed-header';

    const icon = document.createElement('span');
    icon.className = 'excalidraw-embed-icon';
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`;

    const label = document.createElement('span');
    label.className = 'excalidraw-embed-label';
    label.textContent = entry.label.replace(/\.excalidraw$/i, '');

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'excalidraw-embed-btn';
    expandBtn.title = 'Expand diagram';
    expandBtn.setAttribute('aria-label', 'Toggle diagram size');
    expandBtn.textContent = 'Expand';

    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'excalidraw-embed-btn';
    maxBtn.title = 'Maximize diagram';
    maxBtn.setAttribute('aria-label', 'Maximize diagram');
    maxBtn.textContent = 'Max';

    header.append(icon, label, expandBtn, maxBtn);

    const theme = this.getTheme?.() || 'dark';
    const iframe = document.createElement('iframe');
    iframe.className = 'excalidraw-embed-iframe';
    iframe.dataset.instanceId = String(++this.instanceCounter);
    const iframeUrl = new URL('/excalidraw-editor.html', window.location.origin);
    iframeUrl.searchParams.set('file', entry.filePath);
    iframeUrl.searchParams.set('theme', theme);
    const localUser = this.getLocalUser?.();
    if (localUser?.name) {
      iframeUrl.searchParams.set('userName', localUser.name);
    }
    if (localUser?.color) {
      iframeUrl.searchParams.set('userColor', localUser.color);
    }
    if (localUser?.colorLight) {
      iframeUrl.searchParams.set('userColorLight', localUser.colorLight);
    }
    if (localUser?.peerId) {
      iframeUrl.searchParams.set('userPeerId', localUser.peerId);
    }
    const serverOverride = new URLSearchParams(window.location.search).get('server');
    if (serverOverride) {
      iframeUrl.searchParams.set('server', serverOverride);
    }
    iframe.src = iframeUrl.toString();
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.setAttribute('loading', 'lazy');
    iframe.title = `Excalidraw: ${entry.filePath}`;
    iframe.style.height = `${DEFAULT_HEIGHT}px`;

    const resizer = document.createElement('div');
    resizer.className = 'excalidraw-embed-resizer';
    resizer.title = 'Drag to resize';
    this._setupResizer(resizer, iframe);

    wrapper.append(header, iframe, resizer);

    let isExpanded = false;
    let isMaximized = false;
    let restoreHeight = `${DEFAULT_HEIGHT}px`;

    const exitMaximize = () => {
      if (!isMaximized) return;
      isMaximized = false;
      wrapper.classList.remove('is-maximized');
      maxBtn.textContent = 'Max';
      maxBtn.title = 'Maximize diagram';
      maxBtn.setAttribute('aria-label', 'Maximize diagram');
      document.body.classList.remove('excalidraw-maximized-open');
      iframe.style.height = restoreHeight;
      if (this.maximizedEmbed?.wrapper === wrapper) {
        this.maximizedEmbed = null;
      }
    };

    const enterMaximize = () => {
      if (isMaximized) return;
      this._exitMaximizedEmbed();
      isMaximized = true;
      restoreHeight = iframe.style.height || `${DEFAULT_HEIGHT}px`;
      wrapper.classList.add('is-maximized');
      maxBtn.textContent = 'Min';
      maxBtn.title = 'Restore diagram size';
      maxBtn.setAttribute('aria-label', 'Restore diagram size');
      document.body.classList.add('excalidraw-maximized-open');
      this.maximizedEmbed = { wrapper, exit: exitMaximize };
    };

    expandBtn.addEventListener('click', () => {
      if (isMaximized) return;
      isExpanded = !isExpanded;
      wrapper.classList.toggle('is-expanded', isExpanded);
      expandBtn.textContent = isExpanded ? 'Collapse' : 'Expand';

      if (isExpanded) {
        iframe.style.height = `${Math.max(600, window.innerHeight * 0.7)}px`;
      } else {
        iframe.style.height = `${DEFAULT_HEIGHT}px`;
      }
    });

    maxBtn.addEventListener('click', () => {
      if (isMaximized) {
        exitMaximize();
      } else {
        enterMaximize();
      }
    });

    return {
      iframe,
      instanceId: iframe.dataset.instanceId,
      labelElement: label,
      wrapper,
    };
  }

  _setupResizer(resizer, iframe) {
    let startY = 0;
    let startHeight = 0;

    const onPointerMove = (event) => {
      const delta = event.clientY - startY;
      const newHeight = Math.min(Math.max(startHeight + delta, MIN_HEIGHT), MAX_HEIGHT);
      iframe.style.height = `${newHeight}px`;
      iframe.style.pointerEvents = 'none';
    };

    const onPointerUp = () => {
      iframe.style.pointerEvents = '';
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    resizer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      startY = event.clientY;
      startHeight = iframe.offsetHeight;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  }

  _onPreviewClick(event) {
    const loadButton = event.target.closest('.excalidraw-embed-placeholder-btn');
    if (!loadButton) {
      return;
    }

    event.preventDefault();
    const entry = this.embedEntries.get(loadButton.dataset.embedKey);
    if (entry) {
      void this._hydrateEntry(entry);
    }
  }

  _onMessage(event) {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'excalidraw-editor') return;

    if (msg.type === 'ready') {
      // Embed stays silent until the user interacts with the iframe.
    }
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this._exitMaximizedEmbed();
    }
  }

  _exitMaximizedEmbed() {
    if (this.maximizedEmbed?.exit) {
      this.maximizedEmbed.exit();
    }
    this.maximizedEmbed = null;
    document.body.classList.remove('excalidraw-maximized-open');
  }
}
