import { afterEach, describe, expect, it } from 'vitest';

import { renderAppShell } from '../../src/client/presentation/app-shell-renderer.js';

describe('single-page floating controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the exit button and a preview/split segmented toggle in the cluster', () => {
    document.body.innerHTML = '<div id="appRoot"></div>';
    renderAppShell(document);

    const cluster = document.getElementById('singlePageControls');
    expect(cluster).not.toBeNull();
    expect(cluster?.classList.contains('single-page-controls')).toBe(true);

    const buttons = cluster?.querySelectorAll('button.view-btn[data-view]') ?? [];
    const views = Array.from(buttons).map((button) => button.getAttribute('data-view'));
    expect(views).toEqual(['preview', 'split']);

    const previewButton = cluster?.querySelector('button.view-btn[data-view="preview"]');
    expect(previewButton?.classList.contains('active')).toBe(true);

    const exitButton = cluster?.querySelector('#singlePageExitBtn');
    expect(exitButton).not.toBeNull();
    expect(exitButton?.classList.contains('single-page-controls__exit')).toBe(true);
    expect(exitButton?.getAttribute('aria-label')).toBe('Exit single-page mode');
  });
});
