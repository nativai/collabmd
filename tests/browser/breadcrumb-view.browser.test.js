import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderBreadcrumb, closeBreadcrumbOverflowMenu } from '../../src/client/presentation/breadcrumb-view.js';

const SEGMENTS = [
  { name: 'Operating System', path: 'Operating System', isLeaf: false },
  { name: 'Projects', path: 'Operating System/Projects', isLeaf: false },
  { name: 'collabmd', path: 'Operating System/Projects/collabmd', isLeaf: false },
  { name: 'PROJECT.md', path: 'Operating System/Projects/collabmd/PROJECT.md', isLeaf: true },
];

afterEach(() => {
  closeBreadcrumbOverflowMenu();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('renderBreadcrumb (reusable view)', () => {
  it('renders a nav>ol with root, folder crumbs, separators, and a leaf marker', () => {
    const nav = renderBreadcrumb(SEGMENTS);

    expect(nav.tagName).toBe('NAV');
    expect(nav.classList.contains('breadcrumb-bar')).toBe(true);
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(nav.querySelector('.breadcrumb-list').tagName).toBe('OL');

    expect(nav.querySelector('.breadcrumb-crumb--root')).not.toBeNull();
    expect(Array.from(nav.querySelectorAll('.breadcrumb-crumb--folder')).map((el) => el.textContent))
      .toEqual(['Operating System', 'Projects', 'collabmd']);

    const leaf = nav.querySelector('.breadcrumb-crumb--leaf');
    expect(leaf.tagName).toBe('SPAN');
    expect(leaf.getAttribute('aria-current')).toBe('page');
    expect(leaf.textContent).toBe('PROJECT.md');

    // root + 3 folders + leaf → 4 separators, all decorative
    const seps = nav.querySelectorAll('.breadcrumb-sep');
    expect(seps.length).toBe(4);
    seps.forEach((sep) => expect(sep.getAttribute('aria-hidden')).toBe('true'));

    expect(nav.title).toBe('Operating System / Projects / collabmd / PROJECT.md');
  });

  it('wires folder + root clicks to onNavigateToFolder with cumulative paths', () => {
    const onNavigateToFolder = vi.fn();
    const nav = renderBreadcrumb(SEGMENTS, { onNavigateToFolder });

    nav.querySelector('.breadcrumb-crumb--root').click();
    expect(onNavigateToFolder).toHaveBeenCalledWith('');

    Array.from(nav.querySelectorAll('.breadcrumb-crumb--folder'))
      .find((el) => el.textContent === 'Projects')
      .click();
    expect(onNavigateToFolder).toHaveBeenCalledWith('Operating System/Projects');
  });

  it('interactive:false renders spans with no handlers (display-only)', () => {
    const onNavigateToFolder = vi.fn();
    const nav = renderBreadcrumb(SEGMENTS, { interactive: false, onNavigateToFolder });

    expect(nav.querySelectorAll('button').length).toBe(0);
    nav.querySelector('.breadcrumb-crumb--root').click?.();
    Array.from(nav.querySelectorAll('.breadcrumb-crumb--folder')).forEach((el) => el.click?.());
    expect(onNavigateToFolder).not.toHaveBeenCalled();
  });

  it('showRoot:false omits the vault-root crumb', () => {
    const nav = renderBreadcrumb(SEGMENTS, { showRoot: false });
    expect(nav.querySelector('.breadcrumb-crumb--root')).toBeNull();
    // 3 folders + leaf → 3 separators
    expect(nav.querySelectorAll('.breadcrumb-sep').length).toBe(3);
  });

  it('opt-in interactive leaf (onNavigateToFile) renders a clickable leaf', () => {
    const onNavigateToFile = vi.fn();
    const nav = renderBreadcrumb(SEGMENTS, { onNavigateToFile });
    const leaf = nav.querySelector('.breadcrumb-crumb--leaf');
    expect(leaf.tagName).toBe('BUTTON');
    leaf.click();
    expect(onNavigateToFile).toHaveBeenCalledWith('Operating System/Projects/collabmd/PROJECT.md');
  });

  it('folds hiddenSegments into a … menu that reveals every hidden ancestor', () => {
    document.body.innerHTML = '';
    const onNavigateToFolder = vi.fn();
    const hiddenSegments = [SEGMENTS[0], SEGMENTS[1]]; // Operating System, Projects
    const nav = renderBreadcrumb(SEGMENTS, { onNavigateToFolder, hiddenSegments });
    document.body.append(nav);

    // Hidden folders are not inline; the immediate parent (collabmd) stays inline.
    expect(Array.from(nav.querySelectorAll('.breadcrumb-crumb--folder')).map((el) => el.textContent))
      .toEqual(['collabmd']);

    const overflow = nav.querySelector('.breadcrumb-crumb--overflow');
    expect(overflow.getAttribute('aria-haspopup')).toBe('menu');
    overflow.click();

    const menu = document.querySelector('.breadcrumb-overflow-menu');
    expect(menu).not.toBeNull();
    expect(Array.from(menu.querySelectorAll('.breadcrumb-overflow-item-label')).map((el) => el.textContent))
      .toEqual(['Operating System', 'Projects']);

    menu.querySelectorAll('.breadcrumb-overflow-item')[1].click();
    expect(onNavigateToFolder).toHaveBeenCalledWith('Operating System/Projects');
    expect(document.querySelector('.breadcrumb-overflow-menu')).toBeNull();
  });

  it('renders an empty nav for an empty segment array', () => {
    const nav = renderBreadcrumb([]);
    expect(nav.querySelector('.breadcrumb-list').children.length).toBe(0);
  });
});
