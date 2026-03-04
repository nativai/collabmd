const DARK_THEME_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
const LIGHT_THEME_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

export class ThemeController {
  constructor({ storageKey = 'collabmd-theme', onChange }) {
    this.storageKey = storageKey;
    this.onChange = onChange;
    this.currentTheme = 'dark';
  }

  initialize() {
    this.currentTheme = this.readPreferredTheme();
    this.applyTheme();

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => this.toggle());
    });
  }

  getTheme() {
    return this.currentTheme;
  }

  toggle() {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.persistTheme();
    this.applyTheme();
  }

  readPreferredTheme() {
    try {
      const storedTheme = window.localStorage.getItem(this.storageKey);
      if (storedTheme === 'light' || storedTheme === 'dark') {
        return storedTheme;
      }
    } catch {
      // Ignore storage errors in restricted contexts.
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  persistTheme() {
    try {
      window.localStorage.setItem(this.storageKey, this.currentTheme);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    this.updateToggleIcons();
    this.onChange?.(this.currentTheme);
  }

  updateToggleIcons() {
    const icon = this.currentTheme === 'dark' ? DARK_THEME_ICON : LIGHT_THEME_ICON;

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.innerHTML = icon;
    });
  }
}
