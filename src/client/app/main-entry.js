import darkHighlightThemeUrl from '../assets/vendor/highlight/github-dark.min.css?url';
import lightHighlightThemeUrl from '../assets/vendor/highlight/github.min.css?url';
import '../styles/base.css';
import '../styles/style.css';

import { ensureRuntimeConfigLoaded } from '../infrastructure/runtime-config-loader.js';
import { ensureUiComponentStyles } from '../presentation/components/ui/ensure-ui-component-styles.js';

function ensureHighlightThemeStylesheet() {
  let themeStylesheet = document.getElementById('hljs-theme');
  if (!(themeStylesheet instanceof HTMLLinkElement)) {
    themeStylesheet = document.createElement('link');
    themeStylesheet.id = 'hljs-theme';
    themeStylesheet.rel = 'stylesheet';
    document.head.append(themeStylesheet);
  }

  themeStylesheet.href = darkHighlightThemeUrl;
  themeStylesheet.dataset.darkHref = darkHighlightThemeUrl;
  themeStylesheet.dataset.lightHref = lightHighlightThemeUrl;
}

await ensureRuntimeConfigLoaded();
ensureHighlightThemeStylesheet();
await ensureUiComponentStyles();
await import('../main.js');
