import { clamp } from '../domain/vault-utils.js';
import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import {
  createDiagramExportFileNames,
  downloadBlob,
  exportSvgMarkupFromElement,
  rasterizeSvgMarkupToPngBlob,
  writeBlobToClipboard,
} from './diagram-preview-export.js';
import { DiagramPreviewHydrator } from './diagram-preview-hydrator.js';
import {
  createPlantUmlPlaceholderCard,
  easeOutCubic,
  getFrameViewportSize,
  getSvgSize,
  PLANTUML_BATCH_SIZE,
  PLANTUML_ZOOM,
  sanitizeSvgMarkup,
} from './preview-diagram-utils.js';

export class PlantUmlPreviewHydrator extends DiagramPreviewHydrator {
  constructor(renderer, { loadFileSource = null, renderClient = null } = {}) {
    super(renderer, {
      batchSize: PLANTUML_BATCH_SIZE,
      datasetKeys: {
        hydrated: 'plantumlHydrated',
        instanceId: 'plantumlInstanceId',
        key: 'plantumlKey',
        label: 'plantumlLabel',
        queued: 'plantumlQueued',
        sourceHash: 'plantumlSourceHash',
        sourceLine: 'sourceLine',
        sourceLineEnd: 'sourceLineEnd',
        target: 'plantumlTarget',
      },
      filePathLabel: 'PlantUML',
      loadFileSource,
      shellClassName: 'plantuml-shell',
      sourceClassName: 'plantuml-source',
    });
    this.renderer = renderer;
    this.renderClient = renderClient;
    this.svgCache = new Map();
    this.svgInflightRequests = new Map();
    this.shellRefits = new WeakMap();
    this.shellResizeObservers = new WeakMap();
    this.resizeObservers = new Set();
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
    this.disconnectResizeObservers();
    this.maximizedRoot?.remove();
    this.maximizedRoot = null;
  }

  disconnectResizeObservers() {
    this.resizeObservers.forEach((observer) => observer.disconnect());
    this.resizeObservers.clear();
    this.shellResizeObservers = new WeakMap();
  }

  disconnectShellResizeObserver(shell) {
    const observer = this.shellResizeObservers.get(shell);
    if (!observer) {
      return;
    }

    observer.disconnect();
    this.resizeObservers.delete(observer);
    this.shellResizeObservers.delete(shell);
  }

  attachShellResizeObserver(shell, frame, onResize) {
    this.disconnectShellResizeObserver(shell);
    if (typeof ResizeObserver !== 'function' || !shell?.isConnected || !(frame instanceof HTMLElement)) {
      return;
    }

    const observer = new ResizeObserver(() => onResize());
    observer.observe(frame);
    observer.observe(shell);
    this.shellResizeObservers.set(shell, observer);
    this.resizeObservers.add(observer);
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

  handleReconcile({ restoredMaximizedShell }) {
    if (restoredMaximizedShell) {
      document.body.classList.add('plantuml-maximized-open');
    }
    this.syncActiveShell();
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

  async hydrateShell(shell) {
    if (!shell?.isConnected || this.isShellHydrated(shell)) {
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
      this.markShellHydrated(shell);
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

    const request = this.renderClient.renderSvg(source)
      .then((svgMarkup) => {
        const sanitized = sanitizeSvgMarkup(svgMarkup);
        this.svgCache.set(cacheKey, sanitized);
        return sanitized;
      })
      .finally(() => {
        this.svgInflightRequests.delete(cacheKey);
      });

    this.svgInflightRequests.set(cacheKey, request);
    return request;
  }

  resetShell(shell, { clearCache = false, message = 'Renders server-side when visible' } = {}) {
    const source = shell.querySelector('.plantuml-source')?.textContent ?? '';
    if (clearCache && source) {
      this.svgCache.delete(source);
      this.svgInflightRequests.delete(source);
    }

    this.disconnectShellResizeObserver(shell);
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
    toolbar.className = 'plantuml-toolbar diagram-preview-toolbar';
    const leftGroup = document.createElement('div');
    leftGroup.className = 'diagram-preview-toolbar-group diagram-preview-toolbar-group--zoom';
    const rightGroup = document.createElement('div');
    rightGroup.className = 'diagram-preview-toolbar-group diagram-preview-toolbar-group--actions';

    const frame = document.createElement('div');
    frame.className = 'plantuml-frame diagram-preview-frame';
    const decreaseButton = this.createToolButton('−', 'Zoom out');
    const increaseButton = this.createToolButton('+', 'Zoom in');
    const resetButton = this.createToolButton('', 'Reset zoom', { icon: 'fit' });
    const copyButton = this.createToolButton('', 'Copy image', { icon: 'copy' });
    const downloadButton = this.createToolButton('', 'Download SVG', { icon: 'download' });
    const reloadButton = this.createToolButton('', 'Reload diagram', { icon: 'refresh' });
    const maximizeButton = this.createToolButton('', 'Maximize diagram', { icon: 'maximize' });
    maximizeButton.classList.add('plantuml-maximize-btn');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'plantuml-zoom-label diagram-preview-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    leftGroup.append(decreaseButton, zoomLabel, resetButton, increaseButton);
    rightGroup.append(copyButton, downloadButton, reloadButton, maximizeButton);
    toolbar.append(leftGroup, rightGroup);

    const { width: baseWidth, height: baseHeight } = getSvgSize(svg);
    let currentZoom = PLANTUML_ZOOM.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let layoutFrameId = null;
    let isPanning = false;
    let activePointerId = null;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    svg.style.display = 'block';
    svg.style.margin = '0 auto';
    svg.style.maxWidth = 'none';

    const exportSvgMarkup = () => exportSvgMarkupFromElement(svg);

    const exportFileNames = () => createDiagramExportFileNames({
      currentFilePath: this.renderer.getSourceFilePath?.() ?? '',
      diagramKind: 'plantuml',
      sourceLine: shell.getAttribute('data-source-line') || '',
      targetPath: shell.dataset.plantumlTarget || '',
    });

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
      if (layoutFrameId) {
        cancelAnimationFrame(layoutFrameId);
      }

      resetZoomFrameId = requestAnimationFrame(() => {
        layoutFrameId = requestAnimationFrame(() => {
          layoutFrameId = requestAnimationFrame(() => {
            layoutFrameId = null;
            resetZoomFrameId = null;
            if (!shell.isConnected) {
              return;
            }

            resetZoomToFit();
          });
        });
      });
    };

    this.shellRefits.set(shell, scheduleResetZoomToFit);
    this.attachShellResizeObserver(shell, frame, scheduleResetZoomToFit);

    decreaseButton.addEventListener('click', () => zoomBy(-PLANTUML_ZOOM.step));
    increaseButton.addEventListener('click', () => zoomBy(PLANTUML_ZOOM.step));
    resetButton.addEventListener('click', () => {
      scheduleResetZoomToFit();
    });
    copyButton.addEventListener('click', async () => {
      try {
        const { pngFileName } = exportFileNames();
        const pngBlob = await rasterizeSvgMarkupToPngBlob(exportSvgMarkup());
        try {
          await writeBlobToClipboard(pngBlob);
          this.renderer.toastController?.show?.('Diagram copied');
        } catch {
          downloadBlob(pngBlob, pngFileName);
          this.renderer.toastController?.show?.('Clipboard image copy is unavailable here. Downloaded PNG instead.');
        }
      } catch {
        this.renderer.toastController?.show?.('Failed to copy diagram');
      }
    });
    downloadButton.addEventListener('click', () => {
      try {
        const { svgFileName } = exportFileNames();
        const svgBlob = new Blob([exportSvgMarkup()], { type: 'image/svg+xml;charset=utf-8' });
        downloadBlob(svgBlob, svgFileName);
        this.renderer.toastController?.show?.('Diagram download started');
      } catch {
        this.renderer.toastController?.show?.('Failed to download diagram');
      }
    });

    const syncMaximizeButtonState = () => {
      const isMaximized = shell.classList.contains('is-maximized');
      setDiagramActionButtonIcon(maximizeButton, isMaximized ? 'restore' : 'maximize');
      const label = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      maximizeButton.setAttribute('aria-label', label);
      maximizeButton.title = label;
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
            setDiagramActionButtonIcon(activeButton, 'maximize');
            activeButton.setAttribute('aria-label', 'Maximize diagram');
            activeButton.title = 'Maximize diagram';
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
      window.removeEventListener('pointerup', stopPanning, true);
      window.removeEventListener('pointercancel', stopPanning, true);
      window.removeEventListener('mouseup', stopPanning, true);
      window.removeEventListener('touchend', stopPanning, true);
      window.removeEventListener('touchcancel', stopPanning, true);
      window.removeEventListener('blur', stopPanning, true);

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
      window.addEventListener('pointerup', stopPanning, true);
      window.addEventListener('pointercancel', stopPanning, true);
      window.addEventListener('mouseup', stopPanning, true);
      window.addEventListener('touchend', stopPanning, true);
      window.addEventListener('touchcancel', stopPanning, true);
      window.addEventListener('blur', stopPanning, true);
      if (typeof frame.setPointerCapture === 'function') {
        try {
          frame.setPointerCapture(event.pointerId);
        } catch {
          // Safari can reject pointer capture during rapid layout transitions.
        }
      }
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
    frame.addEventListener('mouseleave', stopPanning);
    frame.addEventListener('mouseup', stopPanning);
    frame.addEventListener('touchend', stopPanning);
    frame.addEventListener('touchcancel', stopPanning);

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

  createToolButton(label, ariaLabel, { icon = '' } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plantuml-tool-btn ui-preview-action';
    button.setAttribute('aria-label', ariaLabel);
    button.title = ariaLabel;
    if (icon) {
      setDiagramActionButtonIcon(button, icon);
    } else {
      button.textContent = label;
    }
    return button;
  }
}
