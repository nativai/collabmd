import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreateMenuPresenter } from '../../src/client/presentation/create-menu-presenter.js';

describe('CreateMenuPresenter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens an anchored desktop menu, supports keyboard navigation, and restores focus on escape', () => {
    document.body.innerHTML = '<button id="trigger">Create</button>';
    const trigger = document.getElementById('trigger');
    const presenter = new CreateMenuPresenter({
      mobileBreakpointQuery: { matches: false },
    });

    presenter.open({
      anchor: trigger,
      items: [
        { id: 'markdown', label: 'Markdown note', meta: '.md', onSelect: vi.fn() },
        { id: 'folder', label: 'Folder', meta: 'folder', onSelect: vi.fn() },
      ],
    });

    const menu = document.querySelector('.create-menu');
    expect(menu).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Markdown note');

    menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    expect(document.activeElement?.textContent).toContain('Folder');

    menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(document.querySelector('.create-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders the mobile create picker as an action sheet', () => {
    const presenter = new CreateMenuPresenter({
      mobileBreakpointQuery: { matches: true },
    });

    presenter.open({
      items: [
        { id: 'markdown', group: 'Note', label: 'Markdown note', meta: '.md', onSelect: vi.fn() },
        { id: 'drawio', group: 'Diagram', label: 'draw.io diagram', meta: '.drawio', onSelect: vi.fn() },
      ],
    });

    expect(document.querySelector('.create-action-sheet')).not.toBeNull();
    expect(document.querySelector('.create-action-sheet')?.textContent).toContain('draw.io diagram');
    expect(document.querySelector('.create-action-sheet-option')).not.toBeNull();
    expect(document.querySelector('.create-action-sheet-cancel')).not.toBeNull();
  });
});
