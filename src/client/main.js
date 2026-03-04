import { CollabMdApp } from './application/collabmd-app.js';

function start() {
  const app = new CollabMdApp();
  app.initialize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
