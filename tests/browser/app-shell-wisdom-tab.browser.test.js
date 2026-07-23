import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'lit-html';

import { appShellTemplate } from '../../src/client/presentation/app-shell-template.js';

function renderShell(options) {
  const host = document.createElement('div');
  document.body.append(host);
  render(appShellTemplate(options), host);
  return host;
}

describe('appShellTemplate Wisdom tab gating', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the Wisdom tab when wisdomSearchAvailable is true', () => {
    const host = renderShell({ wisdomSearchAvailable: true });
    const wisdomTab = host.querySelector('[data-qs-mode="wisdom"]');
    expect(wisdomTab).not.toBeNull();
    expect(wisdomTab.textContent).toBe('Wisdom');
    // Files + Text always present regardless of gating.
    expect(host.querySelector('[data-qs-mode="files"]')).not.toBeNull();
    expect(host.querySelector('[data-qs-mode="text"]')).not.toBeNull();
  });

  it('omits the Wisdom tab when wisdomSearchAvailable is false', () => {
    const host = renderShell({ wisdomSearchAvailable: false });
    expect(host.querySelector('[data-qs-mode="wisdom"]')).toBeNull();
    // Files + Text remain — only the Wisdom tab is gated out.
    expect(host.querySelector('[data-qs-mode="files"]')).not.toBeNull();
    expect(host.querySelector('[data-qs-mode="text"]')).not.toBeNull();
  });

  it('omits the Wisdom tab by default (no argument)', () => {
    const host = renderShell();
    expect(host.querySelector('[data-qs-mode="wisdom"]')).toBeNull();
  });
});
