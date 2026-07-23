import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'lit-html';

import { appShellTemplate } from '../../src/client/presentation/app-shell-template.js';
import { renderAppShell } from '../../src/client/presentation/app-shell-renderer.js';
import {
  applyWisdomTabAvailability,
  startWisdomTabAvailabilityMonitor,
} from '../../src/client/bootstrap/wisdom-tab-availability-monitor.js';

function renderShell(options) {
  const host = document.createElement('div');
  document.body.append(host);
  render(appShellTemplate(options), host);
  return host;
}

function installAppRoot() {
  const root = document.createElement('div');
  root.id = 'appRoot';
  document.body.append(root);
  return root;
}

// Drain a queue-backed scheduler so the monitor's async re-check loop runs deterministically.
async function drain(queue) {
  while (queue.length > 0) {
    await queue.shift()();
  }
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

describe('Wisdom tab live availability recovery (brick 25ce51f0)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__COLLABMD_CONFIG__;
  });

  it('applyWisdomTabAvailability inserts the tab, refreshes config, and syncs an existing quick-switcher', () => {
    installAppRoot();
    window.__COLLABMD_CONFIG__ = { wisdomSearch: { available: false, backend: 'wisdom' } };
    renderAppShell(document);
    expect(document.querySelector('[data-qs-mode="wisdom"]')).toBeNull();

    let synced = 0;
    const host = {
      runtimeConfig: { wisdomSearch: { available: false } },
      quickSwitcher: { syncModeTabs: () => { synced += 1; } },
    };

    applyWisdomTabAvailability(host, { available: true, backend: 'wisdom', minQueryLength: 2 });

    expect(document.querySelector('[data-qs-mode="wisdom"]')).not.toBeNull();
    expect(host.runtimeConfig.wisdomSearch.available).toBe(true);
    expect(window.__COLLABMD_CONFIG__.wisdomSearch.available).toBe(true);
    expect(synced).toBe(1);
  });

  it('monitor is a no-op when the engine is already reachable at render', () => {
    let reloaded = false;
    const handle = startWisdomTabAvailabilityMonitor(
      { runtimeConfig: { wisdomSearch: { available: true } } },
      {
        reloadConfig: async () => { reloaded = true; return null; },
        scheduleNext: (fn) => fn(),
      },
    );
    expect(reloaded).toBe(false);
    expect(typeof handle.stop).toBe('function');
  });

  it('monitor adds the Wisdom tab once the engine becomes reachable, then stops re-checking', async () => {
    installAppRoot();
    window.__COLLABMD_CONFIG__ = { wisdomSearch: { available: false, backend: 'wisdom' } };
    renderAppShell(document);
    expect(document.querySelector('[data-qs-mode="wisdom"]')).toBeNull();

    const host = { runtimeConfig: { wisdomSearch: { available: false } }, quickSwitcher: null };
    let calls = 0;
    const reloadConfig = async () => {
      calls += 1;
      // Unreachable on the first re-check, reachable on the second (engine finished binding).
      return calls >= 2
        ? { wisdomSearch: { available: true, backend: 'wisdom', minQueryLength: 2 } }
        : { wisdomSearch: { available: false, backend: 'wisdom' } };
    };
    const queue = [];
    startWisdomTabAvailabilityMonitor(host, {
      reloadConfig,
      scheduleNext: (fn) => queue.push(fn),
      maxAttempts: 5,
    });

    await drain(queue);

    expect(calls).toBe(2);
    expect(document.querySelector('[data-qs-mode="wisdom"]')).not.toBeNull();
  });

  it('monitor gives up after maxAttempts when no engine ever answers — no tab added', async () => {
    installAppRoot();
    window.__COLLABMD_CONFIG__ = { wisdomSearch: { available: false, backend: 'wisdom' } };
    renderAppShell(document);

    const host = { runtimeConfig: { wisdomSearch: { available: false } }, quickSwitcher: null };
    let calls = 0;
    const reloadConfig = async () => {
      calls += 1;
      return { wisdomSearch: { available: false, backend: 'wisdom' } };
    };
    const queue = [];
    startWisdomTabAvailabilityMonitor(host, {
      reloadConfig,
      scheduleNext: (fn) => queue.push(fn),
      maxAttempts: 3,
    });

    await drain(queue);

    expect(calls).toBe(3);
    expect(document.querySelector('[data-qs-mode="wisdom"]')).toBeNull();
  });
});
