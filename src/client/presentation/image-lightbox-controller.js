const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_STEP = 0.25;
const CLICK_ZOOM_SCALE = 2;
const DRAG_THRESHOLD_PX = 6;

export function clampImageLightboxScale(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return MIN_SCALE;
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(numericValue * 100) / 100));
}

export function clampImageLightboxOffset(offset, {
  contentSize = 0,
  scale = 1,
  viewportSize = 0,
} = {}) {
  const numericOffset = Number(offset);
  const numericContentSize = Number(contentSize);
  const numericScale = Number(scale);
  const numericViewportSize = Number(viewportSize);

  if (
    !Number.isFinite(numericOffset)
    || !Number.isFinite(numericContentSize)
    || !Number.isFinite(numericScale)
    || !Number.isFinite(numericViewportSize)
  ) {
    return 0;
  }

  const overflow = ((numericContentSize * numericScale) - numericViewportSize) / 2;
  if (overflow <= 0) {
    return 0;
  }

  return Math.min(Math.max(numericOffset, -overflow), overflow);
}

export class ImageLightboxController {
  constructor({
    previewElement,
    documentRef = document,
    windowRef = window,
  }) {
    this.previewElement = previewElement;
    this.document = documentRef;
    this.window = windowRef;
    this.overlayRoot = null;
    this.viewport = null;
    this.imageElement = null;
    this.zoomLabel = null;
    this.titleElement = null;
    this.isOpen = false;
    this.scale = MIN_SCALE;
    this.offsetX = 0;
    this.offsetY = 0;
    this.activePointerId = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragOriginX = 0;
    this.dragOriginY = 0;
    this.didDrag = false;
    this.zoomInButton = null;
    this.zoomOutButton = null;
    this.resetButton = null;

    this.handlePreviewClick = (event) => {
      const target = event.target;
      if (!(target instanceof this.window.Element)) {
        return;
      }

      const image = target.closest('img');
      if (!image || !this.previewElement?.contains(image)) {
        return;
      }

      if (image.closest('[data-video-overlay-root="true"], [data-excalidraw-overlay-root="true"]')) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation?.();
      this.openFromImage(image);
    };

    this.handleKeyDown = (event) => {
      if (!this.isOpen) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.zoomBy(ZOOM_STEP);
        return;
      }

      if (event.key === '-') {
        event.preventDefault();
        this.zoomBy(-ZOOM_STEP);
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        this.resetView();
      }
    };

    this.handleWindowResize = () => {
      if (!this.isOpen) {
        return;
      }

      this.clampOffsets();
      this.syncTransform();
    };

    this.previewElement?.addEventListener('click', this.handlePreviewClick);
    this.document.addEventListener('keydown', this.handleKeyDown);
    this.window.addEventListener('resize', this.handleWindowResize);
  }

  destroy() {
    this.previewElement?.removeEventListener('click', this.handlePreviewClick);
    this.document.removeEventListener('keydown', this.handleKeyDown);
    this.window.removeEventListener('resize', this.handleWindowResize);
    this.close();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
    this.viewport = null;
    this.imageElement = null;
    this.zoomLabel = null;
    this.titleElement = null;
    this.zoomInButton = null;
    this.zoomOutButton = null;
    this.resetButton = null;
  }

  openFromImage(image) {
    const src = image?.currentSrc || image?.getAttribute?.('src') || '';
    if (!src) {
      return false;
    }

    this.ensureOverlayRoot();
    this.resetView();
    this.titleElement.textContent = image.getAttribute('alt') || 'Image preview';
    this.imageElement.src = src;
    this.imageElement.alt = image.getAttribute('alt') || '';
    this.overlayRoot.hidden = false;
    this.isOpen = true;
    this.document.body.classList.add('image-lightbox-open');
    this.syncTransform();
    this.overlayRoot.focus?.();
    return true;
  }

  close() {
    if (!this.isOpen && !this.overlayRoot) {
      return;
    }

    this.activePointerId = null;
    this.didDrag = false;
    this.viewport?.classList?.remove('is-dragging');
    if (this.overlayRoot) {
      this.overlayRoot.hidden = true;
    }
    this.isOpen = false;
    this.document.body.classList.remove('image-lightbox-open');
  }

  resetView() {
    this.scale = MIN_SCALE;
    this.offsetX = 0;
    this.offsetY = 0;
    this.syncTransform();
  }

  zoomBy(delta) {
    this.setScale(this.scale + delta);
  }

  setScale(nextScale) {
    this.scale = clampImageLightboxScale(nextScale);
    this.clampOffsets();
    this.syncTransform();
  }

  clampOffsets() {
    if (!this.viewport || !this.imageElement) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    this.offsetX = clampImageLightboxOffset(this.offsetX, {
      contentSize: this.imageElement.offsetWidth || 0,
      scale: this.scale,
      viewportSize: this.viewport.clientWidth || 0,
    });
    this.offsetY = clampImageLightboxOffset(this.offsetY, {
      contentSize: this.imageElement.offsetHeight || 0,
      scale: this.scale,
      viewportSize: this.viewport.clientHeight || 0,
    });
  }

  syncTransform() {
    if (!this.imageElement) {
      return;
    }

    this.imageElement.style.transform = `translate3d(${this.offsetX}px, ${this.offsetY}px, 0) scale(${this.scale})`;
    this.imageElement.style.cursor = this.scale > MIN_SCALE ? 'grab' : 'zoom-in';
    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    }
    if (this.zoomOutButton) {
      this.zoomOutButton.disabled = this.scale <= MIN_SCALE;
    }
    if (this.zoomInButton) {
      this.zoomInButton.disabled = this.scale >= MAX_SCALE;
    }
    if (this.resetButton) {
      this.resetButton.disabled = this.scale <= MIN_SCALE && this.offsetX === 0 && this.offsetY === 0;
    }
  }

  ensureOverlayRoot() {
    if (this.overlayRoot?.isConnected && this.overlayRoot.parentElement === this.document.body) {
      return this.overlayRoot;
    }

    const overlayRoot = this.document.createElement('div');
    overlayRoot.className = 'image-lightbox-root';
    overlayRoot.dataset.imageLightboxRoot = 'true';
    overlayRoot.hidden = true;
    overlayRoot.tabIndex = -1;

    const backdrop = this.document.createElement('button');
    backdrop.className = 'image-lightbox-backdrop';
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', 'Close image preview');
    backdrop.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });

    const shell = this.document.createElement('div');
    shell.className = 'image-lightbox-shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-label', 'Image preview');
    shell.addEventListener('click', (event) => event.stopPropagation());
    shell.addEventListener('pointerdown', (event) => event.stopPropagation());

    const toolbar = this.document.createElement('div');
    toolbar.className = 'image-lightbox-toolbar diagram-preview-toolbar';

    const title = this.document.createElement('div');
    title.className = 'image-lightbox-title';
    title.textContent = 'Image preview';

    const controls = this.document.createElement('div');
    controls.className = 'image-lightbox-controls';

    const zoomOutButton = this.createControlButton('-', 'Zoom out', () => this.zoomBy(-ZOOM_STEP), {
      className: 'is-icon-only',
    });
    const zoomLabel = this.document.createElement('span');
    zoomLabel.className = 'image-lightbox-zoom-label diagram-preview-zoom-label';
    zoomLabel.textContent = '100%';
    const zoomInButton = this.createControlButton('+', 'Zoom in', () => this.zoomBy(ZOOM_STEP), {
      className: 'is-icon-only',
    });
    const resetButton = this.createControlButton('Reset', 'Reset zoom and position', () => this.resetView());
    const closeButton = this.createControlButton('Close', 'Close image preview', () => this.close());

    controls.append(zoomOutButton, zoomLabel, zoomInButton, resetButton, closeButton);
    toolbar.append(title, controls);

    const viewport = this.document.createElement('div');
    viewport.className = 'image-lightbox-viewport';

    const image = this.document.createElement('img');
    image.className = 'image-lightbox-image';
    image.alt = '';
    image.addEventListener('load', () => {
      this.clampOffsets();
      this.syncTransform();
    });

    viewport.addEventListener('wheel', (event) => {
      if (!this.isOpen) {
        return;
      }

      event.preventDefault();
      this.zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      if (!this.isOpen || this.scale <= MIN_SCALE || event.button !== 0) {
        return;
      }

      this.activePointerId = event.pointerId;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragOriginX = this.offsetX;
      this.dragOriginY = this.offsetY;
      this.didDrag = false;
      viewport.classList.add('is-dragging');
      viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!this.isOpen || this.activePointerId !== event.pointerId) {
        return;
      }

      if (
        !this.didDrag
        && (Math.abs(event.clientX - this.dragStartX) >= DRAG_THRESHOLD_PX
          || Math.abs(event.clientY - this.dragStartY) >= DRAG_THRESHOLD_PX)
      ) {
        this.didDrag = true;
      }

      this.offsetX = this.dragOriginX + (event.clientX - this.dragStartX);
      this.offsetY = this.dragOriginY + (event.clientY - this.dragStartY);
      this.clampOffsets();
      this.syncTransform();
    });

    const finishDrag = (event) => {
      if (this.activePointerId !== event.pointerId) {
        return;
      }

      this.activePointerId = null;
      viewport.classList.remove('is-dragging');
      viewport.releasePointerCapture?.(event.pointerId);
      this.imageElement.style.cursor = this.scale > MIN_SCALE ? 'grab' : 'zoom-in';
    };

    viewport.addEventListener('pointerup', finishDrag);
    viewport.addEventListener('pointercancel', finishDrag);
    image.addEventListener('click', (event) => {
      if (!this.isOpen) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (this.didDrag) {
        this.didDrag = false;
        return;
      }

      if (this.scale <= MIN_SCALE) {
        this.setScale(CLICK_ZOOM_SCALE);
      }
    });

    viewport.appendChild(image);
    shell.append(toolbar, viewport);
    overlayRoot.append(backdrop, shell);
    this.document.body.appendChild(overlayRoot);

    this.overlayRoot = overlayRoot;
    this.viewport = viewport;
    this.imageElement = image;
    this.zoomLabel = zoomLabel;
    this.titleElement = title;
    this.zoomOutButton = zoomOutButton;
    this.zoomInButton = zoomInButton;
    this.resetButton = resetButton;
    this.syncTransform();
    return overlayRoot;
  }

  createControlButton(label, ariaLabel, onClick, {
    className = '',
  } = {}) {
    const button = this.document.createElement('button');
    button.className = `image-lightbox-btn diagram-preview-action-btn ${className}`.trim();
    button.type = 'button';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    return button;
  }
}
