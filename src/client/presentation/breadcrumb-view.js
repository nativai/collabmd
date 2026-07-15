import { buttonClassNames } from './components/ui/button.js';

/**
 * Stateless, app-agnostic breadcrumb renderer — the single canonical breadcrumb
 * visual language for CollabMD. Both the top-of-file breadcrumb bar and the Fast
 * Tree + Search stream's inline breadcrumbs render through here so the vocabulary
 * (root crumb, folder crumb, leaf, chevron separator, `…` overflow menu) lives in
 * one place.
 *
 * ── Reusable surface for other streams ──────────────────────────────────────
 *   domain/breadcrumb-segments.js  → deriveBreadcrumbSegments(path) → segments[]
 *   presentation/breadcrumb-view.js → renderBreadcrumb(segments, options) → <nav>
 *   styles/layout/breadcrumbs.css  → the shared `.breadcrumb-*` classes (tokens)
 *
 * This module imports only presentation peers (no application/infrastructure), so
 * it stays guardrail-clean and importable anywhere in the client UI layer.
 */

const HOME_ICON = '<svg class="breadcrumb-home-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/></svg>';
const CHEVRON_ICON = '<svg class="breadcrumb-sep-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const FOLDER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

// A single overflow menu is open at a time (a transient popover), tracked here so
// the owning controller can close it on re-render / teardown.
let activeMenu = null;
let activeMenuTrigger = null;
let activeMenuPointerHandler = null;

/**
 * Render a breadcrumb from an ordered `{ name, path, isLeaf }` segment array.
 *
 * @param {Array<{ name: string, path: string, isLeaf: boolean }>} segments  All segments (folders + trailing leaf).
 * @param {object} [options]
 * @param {boolean} [options.interactive=true]  When false, every crumb renders as a non-interactive `<span>` (display-only) and no handlers are wired.
 * @param {(dirPath: string) => void} [options.onNavigateToFolder]  Called with a folder's cumulative path (root passes '').
 * @param {(filePath: string) => void|null} [options.onNavigateToFile]  When provided (and interactive), the leaf becomes clickable; otherwise the leaf is a current-location marker.
 * @param {boolean} [options.showRoot=true]  Prepend the icon-only vault-root crumb.
 * @param {Array<{ name: string, path: string, isLeaf: boolean }>} [options.hiddenSegments=[]]  Middle folders to fold into the `…` overflow menu (empty = render all inline).
 * @returns {HTMLElement}  A `<nav class="breadcrumb-bar">` containing an `<ol class="breadcrumb-list">`.
 */
export function renderBreadcrumb(segments, {
  interactive = true,
  onNavigateToFolder = () => {},
  onNavigateToFile = null,
  showRoot = true,
  hiddenSegments = [],
} = {}) {
  const nav = document.createElement('nav');
  nav.className = 'breadcrumb-bar';
  nav.setAttribute('aria-label', 'Breadcrumb');

  const list = document.createElement('ol');
  list.className = 'breadcrumb-list';
  nav.append(list);

  if (!Array.isArray(segments) || segments.length === 0) {
    return nav;
  }

  const hiddenPaths = new Set(hiddenSegments.map((segment) => segment.path));
  const folders = segments.filter((segment) => !segment.isLeaf);
  const visibleFolders = folders.filter((segment) => !hiddenPaths.has(segment.path));
  const leaf = segments[segments.length - 1];

  const items = [];
  if (showRoot) {
    items.push(createRootItem(interactive, onNavigateToFolder));
  }
  if (hiddenSegments.length > 0) {
    items.push(createOverflowItem(interactive, hiddenSegments, onNavigateToFolder));
  }
  for (const folder of visibleFolders) {
    items.push(createFolderItem(folder, interactive, onNavigateToFolder));
  }
  if (leaf) {
    items.push(createLeafItem(leaf, interactive, onNavigateToFile));
  }

  items.forEach((item, index) => {
    if (index > 0) {
      list.append(createSeparator());
    }
    list.append(item);
  });

  // Full path always available on hover — essential in display-only mode.
  nav.title = segments.map((segment) => segment.name).join(' / ');
  return nav;
}

/** Close the transient overflow menu, if one is open. */
export function closeBreadcrumbOverflowMenu({ restoreFocus = false } = {}) {
  if (activeMenuPointerHandler) {
    document.removeEventListener('pointerdown', activeMenuPointerHandler, true);
    activeMenuPointerHandler = null;
  }
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  if (activeMenuTrigger) {
    activeMenuTrigger.setAttribute('aria-expanded', 'false');
    activeMenuTrigger.classList.remove('active');
    if (restoreFocus) {
      activeMenuTrigger.focus();
    }
    activeMenuTrigger = null;
  }
}

function createListItem(childEl) {
  const item = document.createElement('li');
  item.className = 'breadcrumb-item';
  item.append(childEl);
  return item;
}

function createSeparator() {
  const item = document.createElement('li');
  item.className = 'breadcrumb-sep';
  item.setAttribute('aria-hidden', 'true');
  item.innerHTML = CHEVRON_ICON;
  return item;
}

function createRootItem(interactive, onNavigateToFolder) {
  if (!interactive) {
    const span = document.createElement('span');
    span.className = 'breadcrumb-crumb breadcrumb-crumb--root';
    span.innerHTML = HOME_ICON;
    span.setAttribute('aria-label', 'Vault root');
    return createListItem(span);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${buttonClassNames({ variant: 'ghost', size: 'compact' })} breadcrumb-crumb breadcrumb-crumb--root`;
  button.innerHTML = HOME_ICON;
  button.setAttribute('aria-label', 'Vault root');
  button.title = 'Vault root';
  button.addEventListener('click', () => onNavigateToFolder(''));
  return createListItem(button);
}

function createFolderItem(segment, interactive, onNavigateToFolder) {
  if (!interactive) {
    const span = document.createElement('span');
    span.className = 'breadcrumb-crumb breadcrumb-crumb--folder';
    span.textContent = segment.name;
    return createListItem(span);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${buttonClassNames({ variant: 'ghost', size: 'compact' })} breadcrumb-crumb breadcrumb-crumb--folder`;
  button.textContent = segment.name;
  button.title = segment.name;
  button.addEventListener('click', () => onNavigateToFolder(segment.path));
  return createListItem(button);
}

function createLeafItem(segment, interactive, onNavigateToFile) {
  // Breadcrumb convention: the leaf is the current location. It becomes clickable
  // only when a consumer explicitly opts in with onNavigateToFile.
  if (interactive && typeof onNavigateToFile === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${buttonClassNames({ variant: 'ghost', size: 'compact' })} breadcrumb-crumb breadcrumb-crumb--leaf breadcrumb-crumb--leaf-interactive`;
    button.textContent = segment.name;
    button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => onNavigateToFile(segment.path));
    return createListItem(button);
  }

  const span = document.createElement('span');
  span.className = 'breadcrumb-crumb breadcrumb-crumb--leaf';
  span.textContent = segment.name;
  span.setAttribute('aria-current', 'page');
  return createListItem(span);
}

function createOverflowItem(interactive, hiddenSegments, onNavigateToFolder) {
  const label = `${hiddenSegments.length} hidden folder${hiddenSegments.length === 1 ? '' : 's'}`;

  if (!interactive) {
    const span = document.createElement('span');
    span.className = 'breadcrumb-crumb breadcrumb-crumb--overflow';
    span.textContent = '…';
    span.setAttribute('aria-label', label);
    return createListItem(span);
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
    if (activeMenuTrigger === button) {
      closeBreadcrumbOverflowMenu();
      return;
    }
    openOverflowMenu(button, hiddenSegments, onNavigateToFolder);
  });
  return createListItem(button);
}

function openOverflowMenu(trigger, hiddenSegments, onNavigateToFolder) {
  closeBreadcrumbOverflowMenu();
  if (hiddenSegments.length === 0) {
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'breadcrumb-overflow-menu create-menu';
  menu.setAttribute('role', 'menu');

  const group = document.createElement('div');
  group.className = 'breadcrumb-overflow-group create-menu-group';
  group.textContent = 'Folders in between · click to reveal';
  menu.append(group);

  for (const segment of hiddenSegments) {
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
      onNavigateToFolder(segment.path);
      closeBreadcrumbOverflowMenu();
    });
    menu.append(item);
  }

  menu.addEventListener('keydown', handleMenuKeydown);

  document.body.append(menu);
  activeMenu = menu;
  activeMenuTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('active');

  // Anchor the portal to the `…` rect (escapes the bar's overflow:hidden).
  const rect = trigger.getBoundingClientRect();
  menu.style.left = `${Math.round(rect.left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 4)}px`;

  activeMenuPointerHandler = (event) => {
    if (!activeMenu) {
      return;
    }
    if (activeMenu.contains(event.target) || trigger.contains(event.target)) {
      return;
    }
    closeBreadcrumbOverflowMenu();
  };
  document.addEventListener('pointerdown', activeMenuPointerHandler, true);

  menu.querySelector('.breadcrumb-overflow-item')?.focus();
}

function handleMenuKeydown(event) {
  const items = Array.from(activeMenu?.querySelectorAll('.breadcrumb-overflow-item') ?? []);
  if (items.length === 0) {
    return;
  }
  const currentIndex = items.indexOf(document.activeElement);

  if (event.key === 'Escape') {
    event.preventDefault();
    closeBreadcrumbOverflowMenu({ restoreFocus: true });
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
