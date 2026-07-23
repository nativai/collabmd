let runtimeConfigLoadPromise = null;

function getRuntimeConfigScriptUrl() {
  return new URL('./app-config.js', window.location.href).toString();
}

function createRuntimeConfigScript() {
  const script = document.createElement('script');
  script.src = getRuntimeConfigScriptUrl();
  script.dataset.collabmdRuntimeConfig = 'true';
  return script;
}

export function ensureRuntimeConfigLoaded() {
  if (window.__COLLABMD_CONFIG__) {
    return Promise.resolve(window.__COLLABMD_CONFIG__);
  }

  if (runtimeConfigLoadPromise) {
    return runtimeConfigLoadPromise;
  }

  runtimeConfigLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-collabmd-runtime-config]');
    const script = existingScript instanceof HTMLScriptElement
      ? existingScript
      : createRuntimeConfigScript();

    const cleanup = () => {
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
    };

    const handleError = () => {
      cleanup();
      runtimeConfigLoadPromise = null;
      reject(new Error('Failed to load runtime config'));
    };

    const handleLoad = () => {
      cleanup();
      resolve(window.__COLLABMD_CONFIG__ ?? {});
    };

    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });

    if (!existingScript) {
      document.head.append(script);
    } else if (window.__COLLABMD_CONFIG__) {
      handleLoad();
    }
  });

  return runtimeConfigLoadPromise;
}

/**
 * Re-fetch a FRESH runtime config from the server, bypassing any cache and the memoized
 * first load. Injects a one-shot, cache-busted `/app-config.js` script (the same mechanism
 * as the initial load) — its `window.__COLLABMD_CONFIG__ = {…}` assignment overwrites the
 * global, so a fresh server-side reachability probe (e.g. `wisdomSearch.available`) is
 * reflected without a page reload. Resolves to the refreshed config object.
 */
export function reloadRuntimeConfig() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Cache-bust so we always reach the server (which re-probes engine reachability). The
    // pathname stays `/app-config.js`, so the static handler still matches it.
    const url = new URL('./app-config.js', window.location.href);
    url.searchParams.set('probe', String(Date.now()));
    script.src = url.toString();
    script.dataset.collabmdRuntimeConfigReload = 'true';

    const cleanup = () => {
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
      script.remove();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Failed to reload runtime config'));
    };

    const handleLoad = () => {
      cleanup();
      resolve(window.__COLLABMD_CONFIG__ ?? null);
    };

    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });
    document.head.append(script);
  });
}
