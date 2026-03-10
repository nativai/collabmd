import { clamp } from '../domain/vault-utils.js';
import {
  cancelIdleRender,
  createPlantUmlPlaceholderCard,
  easeOutCubic,
  getFrameViewportSize,
  getSvgSize,
  IDLE_RENDER_TIMEOUT_MS,
  isNearViewport,
  PLANTUML_BATCH_SIZE,
  PLANTUML_ZOOM,
  requestIdleRender,
  sanitizeSvgMarkup,
  shouldPreserveHydratedDiagram,
  syncAttribute,
} from './preview-diagram-utils.js';

export class PlantUmlPreviewHydrator {
  constructor(renderer) {
    this.renderer = renderer;
    this.observer = null;
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
    this.instanceCounter = 0;
    this.preservedShells = new Map();
    this.svgCache = new Map();
    this.fileInflightRequests = new Map();
    this.svgInflightRequests = new Map();
    this.shellRefits = new WeakMap();
    this.activeMaximizedShell = null;
    this.maximizedRoot = null;
    this.resizeFrameId = null;
  }

  destroy() {
    this.cancelHydration();
    this.preservedShells.clear();
    this.clearActiveShell();
    if (this.resizeFrameId) {
      cancelAnimationFrame(this.resizeFrameId);
      this.resizeFrameId = null;
    }
    this.maximizedRoot?.remove();
    this.maximizedRoot = null;
  }

  cancelHydration() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    cancelIdleRender(this.idleId);
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
  }

  cancelPendingIdleWork() {
    cancelIdleRender(this.idleId);
    this.idleId = null;
  }

  clearPreservedShells() {
    this.preservedShells.clear();
  }

  hasPendingWork() {
    return this.hydrationInProgress || this.pendingShells.length > 0;
  }

  clearActiveShell() {
    this.activeMaximizedShell = null;
    if (this.maximizedRoot && this.maximizedRoot.childElementCount === 0) {
      this.maximizedRoot.hidden = true;
    }
  }

  syncActiveShell() {
    if (
      this.activeMaximizedShell?.isConnected
      && this.activeMaximizedShell.classList.contains('is-maximized')
    ) {
      return this.activeMaximizedShell;
    }

    this.clearActiveShell();
    return null;
  }

  scheduleActiveRefit() {
    if (this.resizeFrameId) {
      cancelAnimationFrame(this.resizeFrameId);
    }

    this.resizeFrameId = requestAnimationFrame(() => {
      this.resizeFrameId = null;
      const activeShell = this.syncActiveShell();
      if (!activeShell) {
        return;
      }

      this.shellRefits.get(activeShell)?.();
    });
  }

  preserveHydratedShellsForCommit() {
    this.preservedShells.clear();
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    Array.from(previewElement.querySelectorAll('.plantuml-shell[data-plantuml-hydrated="true"][data-plantuml-key]')).forEach((shell) => {
      const key = shell.dataset.plantumlKey;
      const source = shell.querySelector('.plantuml-source')?.textContent ?? '';
      const target = shell.dataset.plantumlTarget ?? '';
      if (!key || (!source && !target)) {
        return;
      }

      if (shell.isConnected) {
        shell.remove();
      }

      this.preservedShells.set(key, {
        key,
        shell,
        source,
        target,
      });
    });
  }

  reconcileHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement || this.preservedShells.size === 0) {
      this.preservedShells.clear();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(previewElement.querySelectorAll('.plantuml-shell[data-plantuml-key]')).forEach((nextShell) => {
      const key = nextShell.dataset.plantumlKey;
      const preservedEntry = key ? this.preservedShells.get(key) : null;
      if (!preservedEntry) {
        return;
      }

      const nextSource = nextShell.querySelector('.plantuml-source')?.textContent ?? '';
      const nextTarget = nextShell.dataset.plantumlTarget ?? '';
      if (!shouldPreserveHydratedDiagram({
        nextSource,
        nextTarget,
        preservedSource: preservedEntry.source,
        preservedTarget: preservedEntry.target,
      })) {
        return;
      }

      this.syncPreservedShell(preservedEntry.shell, nextShell);
      nextShell.replaceWith(preservedEntry.shell);
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.preservedShells.delete(key);
    });

    this.preservedShells.clear();
    if (restoredMaximizedShell) {
      document.body.classList.add('plantuml-maximized-open');
    }
    this.syncActiveShell();
  }

  syncPreservedShell(preservedShell, nextShell) {
    syncAttribute(preservedShell, nextShell, 'data-source-line');
    syncAttribute(preservedShell, nextShell, 'data-source-line-end');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-key');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-target');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-label');
    syncAttribute(preservedShell, nextShell, 'data-plantuml-source-hash');

    preservedShell.classList.add('plantuml-shell');
    preservedShell.dataset.plantumlHydrated = 'true';
    preservedShell.removeAttribute('data-plantuml-queued');

    const nextSourceNode = nextShell.querySelector('.plantuml-source');
    let preservedSourceNode = preservedShell.querySelector('.plantuml-source');

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      const nextSource = nextSourceNode.textContent ?? '';
      if (nextSource || !nextShell.dataset.plantumlTarget) {
        preservedSourceNode.textContent = nextSource;
      }
      preservedSourceNode.hidden = true;
    }
  }

  ensureMaximizedRoot() {
    if (this.maximizedRoot?.isConnected && this.maximizedRoot.parentElement === document.body) {
      return this.maximizedRoot;
    }

    let maximizedRoot = document.body.querySelector('[data-plantuml-maximized-root="true"]');
    if (!maximizedRoot) {
      maximizedRoot = document.createElement('div');
      maximizedRoot.dataset.plantumlMaximizedRoot = 'true';
      maximizedRoot.className = 'plantuml-maximized-root';
      document.body.appendChild(maximizedRoot);
    }

    this.maximizedRoot = maximizedRoot;
    return maximizedRoot;
  }

  mountShellInMaximizedRoot(shell) {
    if (!shell) {
      return;
    }

    const maximizedRoot = this.ensureMaximizedRoot();
    maximizedRoot.hidden = false;
    shell._plantumlRestoreParent = shell.parentElement || null;
    shell._plantumlRestoreNextSibling = shell.nextSibling || null;
    maximizedRoot.appendChild(shell);
  }

  restoreShellMount(shell) {
    if (!shell) {
      return;
    }

    const restoreParent = shell._plantumlRestoreParent;
    const restoreNextSibling = shell._plantumlRestoreNextSibling;
    if (restoreParent?.isConnected) {
      if (restoreNextSibling?.parentElement === restoreParent) {
        restoreParent.insertBefore(shell, restoreNextSibling);
      } else {
        restoreParent.appendChild(shell);
      }
    }

    shell._plantumlRestoreParent = null;
    shell._plantumlRestoreNextSibling = null;

    if (this.maximizedRoot && this.maximizedRoot.childElementCount === 0) {
      this.maximizedRoot.hidden = true;
    }
  }

  setupHydration(renderVersion) {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    const shells = Array.from(previewElement.querySelectorAll('.plantuml-shell'));
    if (shells.length === 0) {
      return 0;
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueueShell(entry.target);
      });
    }, {
      root: previewContainer,
      rootMargin: this.renderer.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.observer.observe(shell));

    requestAnimationFrame(() => {
      if (renderVersion !== this.renderer.activeRenderVersion) {
        return;
      }

      this.hydrateVisibleShells();
      this.renderer.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisibleShells() {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (this.renderer.hydrationPaused || !previewElement || !previewContainer) {
      return;
    }

    const margin = this.renderer.isLargeDocument ? 180 : 420;
    Array.from(previewElement.querySelectorAll('.plantuml-shell')).forEach((shell) => {
      if (isNearViewport(shell, previewContainer, margin)) {
        this.enqueueShell(shell, { prioritize: true });
      }
    });
  }

  enqueueShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || shell.dataset.plantumlHydrated === 'true' || shell.dataset.plantumlQueued === 'true') {
      return;
    }

    shell.dataset.plantumlQueued = 'true';
    if (prioritize) {
      this.pendingShells.unshift(shell);
    } else {
      this.pendingShells.push(shell);
    }

    if (this.renderer.hydrationPaused) {
      return;
    }

    this.renderer.updateHydrationPhase();
    this.scheduleHydration();
  }

  scheduleHydration() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress || this.idleId !== null) {
      return;
    }

    this.idleId = requestIdleRender(() => {
      this.idleId = null;
      void this.flushHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushHydrationQueue() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress) {
      return;
    }

    const shells = [];
    while (this.pendingShells.length > 0 && shells.length < PLANTUML_BATCH_SIZE) {
      const nextShell = this.pendingShells.shift();
      if (!nextShell?.isConnected || nextShell.dataset.plantumlHydrated === 'true') {
        continue;
      }

      nextShell.removeAttribute('data-plantuml-queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.renderer.updateHydrationPhase();
      return;
    }

    this.hydrationInProgress = true;
    this.renderer.setPhase('hydrating');

    for (const shell of shells) {
      await this.hydrateShell(shell);
    }

    this.hydrationInProgress = false;

    if (this.pendingShells.length > 0) {
      this.scheduleHydration();
    }

    this.renderer.updateHydrationPhase();
  }

  async hydrateShell(shell) {
    if (!shell?.isConnected || shell.dataset.plantumlHydrated === 'true') {
      return;
    }

    let sourceNode = shell.querySelector('.plantuml-source');
    if (!sourceNode) {
      sourceNode = document.createElement('span');
      sourceNode.className = 'plantuml-source';
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }

    shell.querySelector('.plantuml-placeholder-card')?.remove();

    try {
      let source = sourceNode.textContent ?? '';
      if (!source.trim() && shell.dataset.plantumlTarget) {
        source = await this.fetchSource(shell.dataset.plantumlTarget);
        if (!shell.isConnected) {
          return;
        }
        sourceNode.textContent = source;
      }

      if (!source.trim()) {
        throw new Error(shell.dataset.plantumlTarget ? 'PlantUML file is empty' : 'PlantUML source is empty');
      }

      const svgMarkup = await this.fetchSvg(source);

      if (!shell.isConnected) {
        return;
      }

      this.enhanceDiagram(shell, svgMarkup);
      shell.dataset.plantumlHydrated = 'true';
      shell.dataset.plantumlInstanceId = String(++this.instanceCounter);
    } catch (error) {
      console.warn('[preview] PlantUML render failed:', error);
      shell.querySelector(':scope > .plantuml-toolbar')?.remove();
      shell.querySelector(':scope > .plantuml-frame')?.remove();
      if (!shell.querySelector('.plantuml-placeholder-card')) {
        sourceNode?.after(createPlantUmlPlaceholderCard(
          shell.dataset.plantumlKey || 'plantuml',
          error instanceof Error ? error.message : 'Render failed',
        ));
      }
    }
  }

  async fetchSvg(source) {
    const cacheKey = source;
    if (this.svgCache.has(cacheKey)) {
      return this.svgCache.get(cacheKey);
    }

    if (this.svgInflightRequests.has(cacheKey)) {
      return this.svgInflightRequests.get(cacheKey);
    }

    const request = fetch('/api/plantuml/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || typeof data.svg !== 'string') {
          throw new Error(data?.error || 'Failed to render PlantUML');
        }

        const sanitized = sanitizeSvgMarkup(data.svg);
        this.svgCache.set(cacheKey, sanitized);
        return sanitized;
      })
      .finally(() => {
        this.svgInflightRequests.delete(cacheKey);
      });

    this.svgInflightRequests.set(cacheKey, request);
    return request;
  }

  async fetchSource(filePath) {
    const target = String(filePath ?? '').trim();
    if (!target) {
      throw new Error('Missing PlantUML file path');
    }

    if (this.fileInflightRequests.has(target)) {
      return this.fileInflightRequests.get(target);
    }

    const request = fetch(`/api/file?path=${encodeURIComponent(target)}`, {
      headers: {
        Accept: 'application/json',
      },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || typeof data?.content !== 'string') {
          throw new Error(data?.error || `Failed to load ${target}`);
        }

        return data.content;
      })
      .finally(() => {
        this.fileInflightRequests.delete(target);
      });

    this.fileInflightRequests.set(target, request);
    return request;
  }

  resetShell(shell, { clearCache = false, message = 'Renders server-side when visible' } = {}) {
    const source = shell.querySelector('.plantuml-source')?.textContent ?? '';
    if (clearCache && source) {
      this.svgCache.delete(source);
      this.svgInflightRequests.delete(source);
    }

    this.shellRefits.delete(shell);
    if (this.activeMaximizedShell === shell) {
      this.restoreShellMount(shell);
      this.clearActiveShell();
    }

    shell.removeAttribute('data-plantuml-hydrated');
    shell.removeAttribute('data-plantuml-instance-id');
    shell.removeAttribute('data-plantuml-queued');
    shell.classList.remove('is-maximized');
    if (!this.syncActiveShell()) {
      document.body.classList.remove('plantuml-maximized-open');
    }
    shell.querySelector(':scope > .plantuml-toolbar')?.remove();
    shell.querySelector(':scope > .plantuml-frame')?.remove();
    if (!shell.querySelector('.plantuml-placeholder-card')) {
      shell.querySelector('.plantuml-source')?.after(createPlantUmlPlaceholderCard(
        shell.dataset.plantumlKey || 'plantuml',
        message,
      ));
    }
  }

  enhanceDiagram(shell, svgMarkup) {
    const container = document.createElement('div');
    container.innerHTML = svgMarkup;
    const svg = container.querySelector('svg');
    if (!svg) {
      throw new Error('Renderer returned invalid SVG');
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'plantuml-toolbar';

    const frame = document.createElement('div');
    frame.className = 'plantuml-frame';
    const decreaseButton = this.createToolButton('−', 'Zoom out');
    const increaseButton = this.createToolButton('+', 'Zoom in');
    const resetButton = this.createToolButton('Reset', 'Reset zoom');
    const reloadButton = this.createToolButton('Reload', 'Reload diagram');
    const maximizeButton = this.createToolButton('Max', 'Maximize diagram');
    maximizeButton.classList.add('plantuml-maximize-btn');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'plantuml-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    toolbar.append(decreaseButton, zoomLabel, resetButton, increaseButton, reloadButton, maximizeButton);

    const { width: baseWidth, height: baseHeight } = getSvgSize(svg);
    let currentZoom = PLANTUML_ZOOM.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let isPanning = false;
    let activePointerId = null;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    svg.style.display = 'block';
    svg.style.margin = '0 auto';
    svg.style.maxWidth = 'none';

    const calculateDefaultZoom = () => {
      const viewport = getFrameViewportSize(frame);
      if (!Number.isFinite(baseWidth) || baseWidth <= 0 || viewport.width <= 0) {
        return PLANTUML_ZOOM.default;
      }

      return clamp(Math.min(PLANTUML_ZOOM.default, viewport.width / baseWidth), PLANTUML_ZOOM.min, PLANTUML_ZOOM.max);
    };

    const applyZoom = (nextZoom) => {
      currentZoom = clamp(nextZoom, PLANTUML_ZOOM.min, PLANTUML_ZOOM.max);

      svg.style.width = `${baseWidth * currentZoom}px`;
      svg.style.height = `${baseHeight * currentZoom}px`;
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;

      decreaseButton.disabled = currentZoom <= PLANTUML_ZOOM.min;
      increaseButton.disabled = currentZoom >= PLANTUML_ZOOM.max;

      const viewport = getFrameViewportSize(frame);
      const isPannable = (baseWidth * currentZoom) > viewport.width || (baseHeight * currentZoom) > viewport.height;
      frame.classList.toggle('is-pannable', isPannable);
    };

    const getViewportCenter = () => ({
      x: frame.scrollLeft + (frame.clientWidth / 2),
      y: frame.scrollTop + (frame.clientHeight / 2),
    });

    const restoreViewportCenter = (previousZoom, nextZoom, center) => {
      if (previousZoom === 0) {
        return;
      }

      const scale = nextZoom / previousZoom;
      frame.scrollLeft = (center.x * scale) - (frame.clientWidth / 2);
      frame.scrollTop = (center.y * scale) - (frame.clientHeight / 2);
    };

    const animateZoomTo = (nextZoom) => {
      const targetZoom = clamp(nextZoom, PLANTUML_ZOOM.min, PLANTUML_ZOOM.max);
      const startZoom = currentZoom;

      if (targetZoom === startZoom) {
        return;
      }

      const center = getViewportCenter();
      const startedAt = performance.now();

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
      }

      const tick = (now) => {
        const progress = clamp((now - startedAt) / PLANTUML_ZOOM.animationDurationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        const animatedZoom = startZoom + ((targetZoom - startZoom) * easedProgress);

        applyZoom(animatedZoom);
        restoreViewportCenter(startZoom, animatedZoom, center);

        if (progress < 1) {
          zoomAnimationFrameId = requestAnimationFrame(tick);
          return;
        }

        zoomAnimationFrameId = null;
        applyZoom(targetZoom);
        restoreViewportCenter(startZoom, targetZoom, center);
      };

      zoomAnimationFrameId = requestAnimationFrame(tick);
    };

    const zoomBy = (delta) => {
      animateZoomTo(currentZoom + delta);
    };

    const resetZoomToFit = ({ animate = false } = {}) => {
      defaultZoom = calculateDefaultZoom();

      if (animate && Math.abs(defaultZoom - currentZoom) > 0.001) {
        animateZoomTo(defaultZoom);
        return;
      }

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      applyZoom(defaultZoom);
      frame.scrollLeft = 0;
      frame.scrollTop = 0;
    };

    let resetZoomFrameId = null;
    const scheduleResetZoomToFit = () => {
      if (resetZoomFrameId) {
        cancelAnimationFrame(resetZoomFrameId);
      }

      resetZoomFrameId = requestAnimationFrame(() => {
        resetZoomFrameId = null;
        if (!shell.isConnected) {
          return;
        }

        resetZoomToFit();
      });
    };

    this.shellRefits.set(shell, scheduleResetZoomToFit);

    decreaseButton.addEventListener('click', () => zoomBy(-PLANTUML_ZOOM.step));
    increaseButton.addEventListener('click', () => zoomBy(PLANTUML_ZOOM.step));
    resetButton.addEventListener('click', () => {
      resetZoomToFit({ animate: true });
    });

    const syncMaximizeButtonState = () => {
      const isMaximized = shell.classList.contains('is-maximized');
      maximizeButton.textContent = isMaximized ? 'Restore' : 'Max';
      maximizeButton.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    const setMaximizedState = (shouldMaximize) => {
      if (shouldMaximize) {
        const activeContainer = this.syncActiveShell();
        if (activeContainer && activeContainer !== shell) {
          this.restoreShellMount(activeContainer);
          activeContainer.classList.remove('is-maximized');
          if (this.activeMaximizedShell === activeContainer) {
            this.clearActiveShell();
          }
          this.shellRefits.get(activeContainer)?.();
          const activeButton = activeContainer.querySelector('.plantuml-maximize-btn');
          if (activeButton) {
            activeButton.textContent = 'Max';
            activeButton.setAttribute('aria-label', 'Maximize diagram');
          }
        }

        this.mountShellInMaximizedRoot(shell);
        shell.classList.add('is-maximized');
        this.activeMaximizedShell = shell;
        document.body.classList.add('plantuml-maximized-open');
        syncMaximizeButtonState();
        scheduleResetZoomToFit();
        return;
      }

      this.restoreShellMount(shell);
      shell.classList.remove('is-maximized');
      if (this.activeMaximizedShell === shell) {
        this.clearActiveShell();
      }
      if (!this.syncActiveShell()) {
        document.body.classList.remove('plantuml-maximized-open');
      }
      syncMaximizeButtonState();
      scheduleResetZoomToFit();
    };

    reloadButton.addEventListener('click', () => {
      this.resetShell(shell, {
        clearCache: true,
        message: 'Refreshing…',
      });
      this.enqueueShell(shell, { prioritize: true });
    });

    syncMaximizeButtonState();
    maximizeButton.addEventListener('click', () => {
      setMaximizedState(!shell.classList.contains('is-maximized'));
    });

    const stopPanning = () => {
      if (!isPanning) {
        return;
      }

      isPanning = false;
      frame.classList.remove('is-dragging');

      if (activePointerId !== null && typeof frame.releasePointerCapture === 'function') {
        try {
          frame.releasePointerCapture(activePointerId);
        } catch {
          // Ignore capture release issues during drag end.
        }
      }

      activePointerId = null;
    };

    frame.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !frame.classList.contains('is-pannable')) {
        return;
      }

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      isPanning = true;
      activePointerId = event.pointerId;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartScrollLeft = frame.scrollLeft;
      panStartScrollTop = frame.scrollTop;

      frame.classList.add('is-dragging');
      frame.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    frame.addEventListener('pointermove', (event) => {
      if (!isPanning) {
        return;
      }

      frame.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
      frame.scrollTop = panStartScrollTop - (event.clientY - panStartY);
    });

    frame.addEventListener('pointerup', stopPanning);
    frame.addEventListener('pointercancel', stopPanning);
    frame.addEventListener('lostpointercapture', stopPanning);

    frame.appendChild(svg);
    const sourceNode = shell.querySelector('.plantuml-source');
    shell.replaceChildren();
    if (sourceNode) {
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }
    shell.append(toolbar, frame);

    defaultZoom = calculateDefaultZoom();
    applyZoom(defaultZoom);
  }

  createToolButton(label, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plantuml-tool-btn';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    return button;
  }
}
