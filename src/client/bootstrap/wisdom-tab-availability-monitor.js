import { reloadRuntimeConfig } from '../infrastructure/runtime-config-loader.js';
import { renderAppShell } from '../presentation/app-shell-renderer.js';

// The co-located wisdom engine can bind its port slightly AFTER collabmd starts serving, so
// the first `/app-config.js` probe legitimately reports the engine unreachable and the Wisdom
// tab is gated out at initial render. This monitor re-checks availability a few times after
// load and, once the engine answers, adds the tab live — no manual reload (brick 25ce51f0).
// It is a no-op when the engine is already reachable at render, and it gives up quietly after
// a bounded number of attempts so a deployment with NO engine keeps showing no tab.
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_ATTEMPTS = 8;

/**
 * Reflect a now-reachable engine in the live UI: refresh the config the quick-switcher reads,
 * re-render the app shell (lit-html inserts the Wisdom mode tab), and wire the new tab into an
 * already-constructed quick-switcher. Safe to call once availability has flipped to true.
 */
export function applyWisdomTabAvailability(host, wisdomConfig) {
  // Keep the global in sync so renderAppShell (which reads window.__COLLABMD_CONFIG__ via
  // getClientRuntimeConfig) renders the tab, and future getRuntimeConfig() reads agree.
  if (typeof window !== 'undefined' && window.__COLLABMD_CONFIG__) {
    window.__COLLABMD_CONFIG__.wisdomSearch = wisdomConfig;
  }
  // Refresh the snapshot the quick-switcher loader reads (host.runtimeConfig.wisdomSearch).
  if (host?.runtimeConfig) {
    host.runtimeConfig.wisdomSearch = wisdomConfig;
  }
  renderAppShell(document);
  // If the quick-switcher was already built (user opened ⌘K before the engine came up), teach
  // it about the freshly-inserted tab. Otherwise the lazy first-⌘K build picks it up itself.
  host?.quickSwitcher?.syncModeTabs?.();
}

/**
 * Start the bounded post-load re-check. Returns a handle with `stop()`. Dependencies are
 * injectable for testing; production callers pass none.
 */
export function startWisdomTabAvailabilityMonitor(host, {
  reloadConfig = reloadRuntimeConfig,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  scheduleNext = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  // Already reachable at initial render → the tab is present; nothing to recover.
  if (host?.runtimeConfig?.wisdomSearch?.available) {
    return { stop() {} };
  }

  let attempts = 0;
  let stopped = false;

  const tick = async () => {
    if (stopped) {
      return;
    }
    attempts += 1;

    let fresh;
    try {
      fresh = await reloadConfig();
    } catch {
      fresh = null;
    }
    if (stopped) {
      return;
    }

    if (fresh?.wisdomSearch?.available) {
      applyWisdomTabAvailability(host, fresh.wisdomSearch);
      return; // engine reachable, tab added — done.
    }

    if (attempts >= maxAttempts) {
      return; // bounded: give up. No engine ⇒ still no tab.
    }
    scheduleNext(tick, intervalMs);
  };

  scheduleNext(tick, intervalMs);
  return { stop() { stopped = true; } };
}
