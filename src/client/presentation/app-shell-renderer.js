import { render } from 'lit-html';

import { getClientRuntimeConfig } from '../domain/runtime-paths.js';
import { appShellTemplate } from './app-shell-template.js';

export function renderAppShell(doc = document) {
  const host = doc.getElementById('appRoot');
  if (!host) {
    throw new Error('App shell root element #appRoot is missing.');
  }

  // Gate the Wisdom search tab on live engine reachability (settled server-side by the
  // /app-config.js probe). No co-located engine ⇒ no tab. ensureRuntimeConfigLoaded()
  // (main-entry.js) has already populated window.__COLLABMD_CONFIG__ before this runs.
  render(appShellTemplate({
    wisdomSearchAvailable: Boolean(getClientRuntimeConfig()?.wisdomSearch?.available),
  }), host);
  return host;
}
