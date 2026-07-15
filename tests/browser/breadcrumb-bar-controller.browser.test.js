import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BreadcrumbBarController } from '../../src/client/presentation/breadcrumb-bar-controller.js';

// CSS is not loaded in the component test, so give the list a horizontal layout
// and each crumb some width — this lets the overflow (scrollWidth > clientWidth)
// measurement behave like it does in the real app.
let styleEl;

beforeEach(() => {
  styleEl = document.createElement('style');
  styleEl.textContent = `
    .breadcrumb-bar { overflow: hidden; white-space: nowrap; }
    .breadcrumb-list { display: flex; gap: 4px; align-items: center; margin: 0; padding: 0; list-style: none; }
    .breadcrumb-item, .breadcrumb-sep { flex: 0 0 auto; }
    .breadcrumb-crumb { display: inline-flex; white-space: nowrap; padding: 0 18px; }
  `;
  document.head.append(styleEl);
});

afterEach(() => {
  styleEl?.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountBar() {
  const nav = document.createElement('nav');
  nav.id = 'breadcrumbBar';
  nav.className = 'breadcrumb-bar hidden';
  document.body.append(nav);
  return nav;
}

describe('BreadcrumbBarController', () => {
  it('renders root, ancestor folders, separators, and a non-interactive leaf', () => {
    const container = mountBar();
    const controller = new BreadcrumbBarController({ container });

    controller.update('Operating System/Projects/collabmd/PROJECT.md');

    expect(container.classList.contains('hidden')).toBe(false);

    const root = container.querySelector('.breadcrumb-crumb--root');
    expect(root).not.toBeNull();
    expect(root.getAttribute('aria-label')).toBe('Vault root');

    const folders = container.querySelectorAll('.breadcrumb-crumb--folder');
    expect(Array.from(folders).map((el) => el.textContent)).toEqual([
      'Operating System',
      'Projects',
      'collabmd',
    ]);

    const leaf = container.querySelector('.breadcrumb-crumb--leaf');
    expect(leaf.textContent).toBe('PROJECT.md');
    expect(leaf.tagName).toBe('SPAN');
    expect(leaf.getAttribute('aria-current')).toBe('page');

    // root + 3 folders + leaf = 4 separators
    expect(container.querySelectorAll('.breadcrumb-sep').length).toBe(4);
    container.querySelectorAll('.breadcrumb-sep').forEach((sep) => {
      expect(sep.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('hides the bar for an empty / cleared path', () => {
    const container = mountBar();
    const controller = new BreadcrumbBarController({ container });

    controller.update('docs/guide/intro.md');
    expect(container.classList.contains('hidden')).toBe(false);

    controller.update(null);
    expect(container.classList.contains('hidden')).toBe(true);
    expect(container.children.length).toBe(0);
  });

  it('renders a top-level file as root + leaf with a single separator (no dangling chevron)', () => {
    const container = mountBar();
    const controller = new BreadcrumbBarController({ container });

    controller.update('README.md');

    expect(container.querySelectorAll('.breadcrumb-crumb--folder').length).toBe(0);
    expect(container.querySelector('.breadcrumb-crumb--leaf').textContent).toBe('README.md');
    expect(container.querySelectorAll('.breadcrumb-sep').length).toBe(1);
  });

  it('fires onNavigateToFolder with the cumulative path when a folder crumb is clicked', () => {
    const container = mountBar();
    const onNavigateToFolder = vi.fn();
    const controller = new BreadcrumbBarController({ container, onNavigateToFolder });

    controller.update('Operating System/Projects/collabmd/PROJECT.md');

    const projects = Array.from(container.querySelectorAll('.breadcrumb-crumb--folder'))
      .find((el) => el.textContent === 'Projects');
    projects.click();
    expect(onNavigateToFolder).toHaveBeenCalledWith('Operating System/Projects');

    container.querySelector('.breadcrumb-crumb--root').click();
    expect(onNavigateToFolder).toHaveBeenCalledWith('');
  });

  it('collapses deep paths into a … menu that keeps every ancestor reachable', () => {
    const container = mountBar();
    container.style.width = '260px';
    const onNavigateToFolder = vi.fn();
    const controller = new BreadcrumbBarController({ container, onNavigateToFolder });

    const path = 'a/b/c/d/e/f/g/deep.md';
    controller.update(path);

    const overflow = container.querySelector('.breadcrumb-crumb--overflow');
    expect(overflow).not.toBeNull();
    expect(overflow.getAttribute('aria-haspopup')).toBe('menu');

    // Open the menu (portal on document.body).
    overflow.click();
    const menu = document.querySelector('.breadcrumb-overflow-menu');
    expect(menu).not.toBeNull();
    expect(overflow.getAttribute('aria-expanded')).toBe('true');

    const visibleFolderPaths = Array.from(container.querySelectorAll('.breadcrumb-crumb--folder'))
      .map((el) => el.title);
    const menuPaths = Array.from(menu.querySelectorAll('.breadcrumb-overflow-item'))
      .map((el) => el.querySelector('.breadcrumb-overflow-item-label').textContent);

    // Every ancestor folder is reachable: visible crumbs ∪ menu items = a..g
    const menuNames = menuPaths;
    const visibleNames = Array.from(container.querySelectorAll('.breadcrumb-crumb--folder'))
      .map((el) => el.textContent);
    expect([...menuNames, ...visibleNames].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    // A menu item reveals its folder.
    const firstItem = menu.querySelector('.breadcrumb-overflow-item');
    firstItem.click();
    expect(onNavigateToFolder).toHaveBeenCalledWith('a');
    expect(document.querySelector('.breadcrumb-overflow-menu')).toBeNull();
    expect(visibleFolderPaths).toContain('a/b/c/d/e/f'); // immediate parent stays inline
  });

  it('is display-only in embed mode: spans, no buttons, no menu, full path in title', () => {
    const container = mountBar();
    container.style.width = '260px';
    const onNavigateToFolder = vi.fn();
    const controller = new BreadcrumbBarController({
      container,
      onNavigateToFolder,
      isEmbedMode: () => true,
    });

    controller.update('a/b/c/d/e/f/g/deep.md');

    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.title).toBe('a / b / c / d / e / f / g / deep.md');

    // The overflow indicator is static: clicking opens nothing.
    const overflow = container.querySelector('.breadcrumb-crumb--overflow');
    expect(overflow.tagName).toBe('SPAN');
    overflow.click?.();
    expect(document.querySelector('.breadcrumb-overflow-menu')).toBeNull();
    expect(onNavigateToFolder).not.toHaveBeenCalled();
  });
});
