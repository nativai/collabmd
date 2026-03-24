import { render } from 'lit-html';

import { appShellTemplate } from './app-shell-template.js';

export function renderAppShell(doc = document) {
  const host = doc.getElementById('appRoot');
  if (!host) {
    throw new Error('App shell root element #appRoot is missing.');
  }

  render(appShellTemplate(), host);
  return host;
}
