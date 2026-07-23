import { CollabMdAppShell } from './bootstrap/collabmd-app-shell.js';
import { startWisdomTabAvailabilityMonitor } from './bootstrap/wisdom-tab-availability-monitor.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';

async function start() {
  await ensureClientAuthenticated();
  const app = new CollabMdAppShell();
  app.initialize();
  // Recover the Wisdom tab if the co-located engine bound its port just after first render
  // (brick 25ce51f0). No-op when already reachable; bounded, so no engine ⇒ still no tab.
  startWisdomTabAvailabilityMonitor(app);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void start();
  }, { once: true });
} else {
  void start();
}
