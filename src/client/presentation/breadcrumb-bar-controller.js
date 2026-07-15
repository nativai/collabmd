import { deriveBreadcrumbSegments } from '../domain/breadcrumb-segments.js';
import { renderBreadcrumb, closeBreadcrumbOverflowMenu } from './breadcrumb-view.js';

/**
 * Owns the app-integration concerns of the top-of-file breadcrumb bar: the
 * reactive `update(filePath)`, embed-mode detection, width-driven overflow
 * collapse, and the folder-reveal callback wiring. The stateless rendering (the
 * canonical breadcrumb visual language) lives in `breadcrumb-view.js`, which this
 * controller drives — the controller decides HOW MUCH to collapse (bar-width
 * dependent), the view just renders the visible + hidden split it is told.
 *
 * Lives in `presentation/`: imports only `domain/` + presentation peers, and
 * receives navigation as injected callbacks (wired in the composition root).
 */
export class BreadcrumbBarController {
  constructor({
    container,
    onNavigateToFolder,
    onNavigateToFile,
    isEmbedMode = () => false,
  } = {}) {
    this.container = container ?? null;
    this.onNavigateToFolder = onNavigateToFolder ?? (() => {});
    this.onNavigateToFile = onNavigateToFile ?? (() => {});
    this.isEmbedMode = isEmbedMode;

    this.currentFilePath = null;
    this.segments = [];

    this.resizeObserver = null;
    if (this.container && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.relayout());
      this.resizeObserver.observe(this.container);
    }
  }

  update(filePath) {
    this.currentFilePath = filePath ?? null;
    this.segments = deriveBreadcrumbSegments(this.currentFilePath);
    closeBreadcrumbOverflowMenu();

    if (!this.container) {
      return;
    }

    if (this.segments.length === 0) {
      this.container.classList.add('hidden');
      this.container.replaceChildren();
      this.container.removeAttribute('title');
      return;
    }

    this.container.classList.remove('hidden');
    this.fitToWidth();
  }

  /** Re-run the fit pass without recomputing segments (resize handler). */
  relayout() {
    if (!this.container || this.segments.length === 0) {
      return;
    }
    if (this.container.classList.contains('hidden')) {
      return;
    }
    closeBreadcrumbOverflowMenu();
    this.fitToWidth();
  }

  /**
   * Collapse middle folders until the single line fits, keeping root + the last
   * two segments (immediate parent + leaf) always visible.
   */
  fitToWidth() {
    const folders = this.segments.filter((segment) => !segment.isLeaf);
    // Collapsible = every folder except the immediate parent (kept as "one level up").
    const collapsibleCount = Math.max(folders.length - 1, 0);

    let collapsed = 0;
    this.renderInto(collapsed);
    while (collapsed < collapsibleCount && this.isOverflowing()) {
      collapsed += 1;
      this.renderInto(collapsed);
    }
  }

  isOverflowing() {
    return this.container.scrollWidth > this.container.clientWidth + 1;
  }

  /**
   * Render into the bar's `#editor-page` host with the first `collapsedCount`
   * middle folders (taken from just after the root) folded into the `…` menu.
   */
  renderInto(collapsedCount) {
    const folders = this.segments.filter((segment) => !segment.isLeaf);
    const collapsibleCount = Math.max(folders.length - 1, 0);
    const count = Math.min(collapsedCount, collapsibleCount);
    const hiddenSegments = folders.slice(0, count);
    const embed = Boolean(this.isEmbedMode?.());

    const nav = renderBreadcrumb(this.segments, {
      interactive: !embed,
      showRoot: true,
      hiddenSegments,
      onNavigateToFolder: this.onNavigateToFolder,
      // The bar's leaf stays a non-interactive current-location marker (per design).
      onNavigateToFile: null,
    });

    this.container.replaceChildren(...Array.from(nav.childNodes));
    if (nav.title) {
      this.container.title = nav.title;
    } else {
      this.container.removeAttribute('title');
    }
  }

  destroy() {
    closeBreadcrumbOverflowMenu();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
