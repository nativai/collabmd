import { deriveBreadcrumbSegments } from '../domain/breadcrumb-segments.js';
import { buttonClassNames } from './components/ui/button.js';

const HOME_ICON = '<svg class="breadcrumb-home-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/></svg>';
const CHEVRON_ICON = '<svg class="breadcrumb-sep-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const FOLDER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

/**
 * Renders the breadcrumb bar for the currently-open file: a vault-root affordance,
 * one crumb per ancestor folder, and a non-interactive leaf for the file itself.
 * Deep paths collapse the middle folders into a `…` reveal-menu. In embed
 * (`single=1`) mode the bar is display-only: it shows the path but wires no handlers.
 *
 * Lives in `presentation/`: imports only `domain/` + presentation peers, and receives
 * navigation as injected callbacks (wired in the bootstrap composition root).
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
    this.menuEl = null;
    this.overflowButton = null;
    this.hiddenSegments = [];
    this.documentPointerHandler = null;

    this.resizeObserver = null;
    if (this.container && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.relayout());
      this.resizeObserver.observe(this.container);
    }
  }

  update(filePath) {
    this.currentFilePath = filePath ?? null;
    this.segments = deriveBreadcrumbSegments(this.currentFilePath);
    this.closeMenu();

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
    this.render(0);
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
    this.closeMenu();
    this.render(0);
    this.fitToWidth();
  }

  /**
   * Collapse middle folders until the single line fits, keeping root + the last two
   * segments (immediate parent + leaf) always visible.
   */
  fitToWidth() {
    const folders = this.segments.filter((segment) => !segment.isLeaf);
    // Collapsible = every folder except the immediate parent (kept as "one level up").
    const collapsibleCount = Math.max(folders.length - 1, 0);

    let collapsed = 0;
    while (collapsed < collapsibleCount && this.isOverflowing()) {
      collapsed += 1;
      this.render(collapsed);
    }
  }

  isOverflowing() {
    return this.container.scrollWidth > this.container.clientWidth + 1;
  }

  render(collapsedCount) {
    const embed = Boolean(this.isEmbedMode?.());
    const folders = this.segments.filter((segment) => !segment.isLeaf);
    const leaf = this.segments[this.segments.length - 1];

    // Folders hidden into the overflow menu: the first `collapsedCount`, taken from
    // just after the root and moving toward the leaf.
    this.hiddenSegments = folders.slice(0, collapsedCount);
    const visibleFolders = folders.slice(collapsedCount);

    const list = document.createElement('ol');
    list.className = 'breadcrumb-list';

    // Root affordance (always first).
    list.append(this.createRootItem(embed));

    if (this.hiddenSegments.length > 0) {
      list.append(this.createSeparator());
      list.append(this.createOverflowItem(embed));
    }

    for (const folder of visibleFolders) {
      list.append(this.createSeparator());
      list.append(this.createFolderItem(folder, embed));
    }

    // Leaf (the current file) — always shown, non-interactive.
    if (leaf) {
      list.append(this.createSeparator());
      list.append(this.createLeafItem(leaf));
    }

    this.container.replaceChildren(list);

    // Full path always available on hover (essential in embed, where the menu is static).
    this.container.title = this.segments.map((segment) => segment.name).join(' / ');
  }

  createListItem(childEl) {
    const item = document.createElement('li');
    item.className = 'breadcrumb-item';
    item.append(childEl);
    return item;
  }

  createSeparator() {
    const item = document.createElement('li');
    item.className = 'breadcrumb-sep';
    item.setAttribute('aria-hidden', 'true');
    item.innerHTML = CHEVRON_ICON;
    return item;
  }

  createRootItem(embed) {
    if (embed) {
      const span = document.createElement('span');
      span.className = 'breadcrumb-crumb breadcrumb-crumb--root';
      span.innerHTML = HOME_ICON;
      span.setAttribute('aria-label', 'Vault root');
      return this.createListItem(span);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${buttonClassNames({ variant: 'ghost', size: 'compact' })} breadcrumb-crumb breadcrumb-crumb--root`;
    button.innerHTML = HOME_ICON;
    button.setAttribute('aria-label', 'Vault root');
    button.title = 'Vault root';
    button.addEventListener('click', () => this.onNavigateToFolder(''));
    return this.createListItem(button);
  }

  createFolderItem(segment, embed) {
    if (embed) {
      const span = document.createElement('span');
      span.className = 'breadcrumb-crumb breadcrumb-crumb--folder';
      span.textContent = segment.name;
      return this.createListItem(span);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${buttonClassNames({ variant: 'ghost', size: 'compact' })} breadcrumb-crumb breadcrumb-crumb--folder`;
    button.textContent = segment.name;
    button.title = segment.name;
    button.addEventListener('click', () => this.onNavigateToFolder(segment.path));
    return this.createListItem(button);
  }

  createLeafItem(segment) {
    const span = document.createElement('span');
    span.className = 'breadcrumb-crumb breadcrumb-crumb--leaf';
    span.textContent = segment.name;
    span.setAttribute('aria-current', 'page');
    return this.createListItem(span);
  }

  createOverflowItem(embed) {
    const label = `${this.hiddenSegments.length} hidden folder${this.hiddenSegments.length === 1 ? '' : 's'}`;

    if (embed) {
      const span = document.createElement('span');
      span.className = 'breadcrumb-crumb breadcrumb-crumb--overflow';
      span.textContent = '…';
      span.setAttribute('aria-label', label);
      return this.createListItem(span);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${buttonClassNames({ variant: 'ghost', size: 'compact' })} breadcrumb-crumb breadcrumb-crumb--overflow`;
    button.textContent = '…';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.title = `Show ${label}`;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleMenu(button);
    });
    this.overflowButton = button;
    return this.createListItem(button);
  }

  toggleMenu(button) {
    if (this.menuEl) {
      this.closeMenu();
      return;
    }
    this.openMenu(button);
  }

  openMenu(button) {
    const hidden = this.hiddenSegments;
    if (hidden.length === 0) {
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'breadcrumb-overflow-menu create-menu';
    menu.setAttribute('role', 'menu');

    const group = document.createElement('div');
    group.className = 'breadcrumb-overflow-group create-menu-group';
    group.textContent = 'Folders in between · click to reveal';
    menu.append(group);

    for (const segment of hidden) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'breadcrumb-overflow-item create-menu-item';
      item.setAttribute('role', 'menuitem');
      item.title = segment.name;

      const icon = document.createElement('span');
      icon.className = 'breadcrumb-overflow-item-icon create-menu-item-icon';
      icon.innerHTML = FOLDER_ICON;

      const text = document.createElement('span');
      text.className = 'breadcrumb-overflow-item-label';
      text.textContent = segment.name;

      item.append(icon, text);
      item.addEventListener('click', () => {
        this.onNavigateToFolder(segment.path);
        this.closeMenu();
      });
      menu.append(item);
    }

    menu.addEventListener('keydown', (event) => this.handleMenuKeydown(event));

    document.body.append(menu);
    this.menuEl = menu;
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('active');

    // Anchor the portal to the `…` rect (escapes the bar's overflow:hidden).
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;

    this.documentPointerHandler = (event) => {
      if (!this.menuEl) {
        return;
      }
      if (this.menuEl.contains(event.target) || button.contains(event.target)) {
        return;
      }
      this.closeMenu();
    };
    document.addEventListener('pointerdown', this.documentPointerHandler, true);

    menu.querySelector('.breadcrumb-overflow-item')?.focus();
  }

  handleMenuKeydown(event) {
    const items = Array.from(this.menuEl?.querySelectorAll('.breadcrumb-overflow-item') ?? []);
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length].focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length].focus();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  }

  closeMenu({ restoreFocus = false } = {}) {
    if (this.documentPointerHandler) {
      document.removeEventListener('pointerdown', this.documentPointerHandler, true);
      this.documentPointerHandler = null;
    }
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    if (this.overflowButton) {
      this.overflowButton.setAttribute('aria-expanded', 'false');
      this.overflowButton.classList.remove('active');
      if (restoreFocus) {
        this.overflowButton.focus();
      }
    }
  }

  destroy() {
    this.closeMenu();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
