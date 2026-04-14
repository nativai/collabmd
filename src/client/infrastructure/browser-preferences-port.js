export class BrowserPreferencesPort {
  constructor({
    chatNotificationsKey,
    lineWrappingKey,
    sidebarVisibleKey,
    sidebarWidthKey,
    userNameKey,
    storage = globalThis.localStorage,
  }) {
    this.chatNotificationsKey = chatNotificationsKey;
    this.lineWrappingKey = lineWrappingKey;
    this.sidebarVisibleKey = sidebarVisibleKey;
    this.sidebarWidthKey = sidebarWidthKey;
    this.storage = storage;
    this.userNameKey = userNameKey;
  }

  getUserName() {
    try {
      return this.storage.getItem(this.userNameKey) || '';
    } catch {
      return '';
    }
  }

  setUserName(name) {
    try {
      this.storage.setItem(this.userNameKey, name);
    } catch {
      // Ignore storage errors.
    }
  }

  getLineWrappingEnabled() {
    try {
      return this.storage.getItem(this.lineWrappingKey) !== 'false';
    } catch {
      return true;
    }
  }

  setLineWrappingEnabled(enabled) {
    try {
      this.storage.setItem(this.lineWrappingKey, String(enabled));
    } catch {
      // Ignore storage errors.
    }
  }

  getSidebarVisible() {
    try {
      return this.storage.getItem(this.sidebarVisibleKey);
    } catch {
      return null;
    }
  }

  setSidebarVisible(showSidebar) {
    try {
      this.storage.setItem(this.sidebarVisibleKey, showSidebar ? 'true' : 'false');
    } catch {
      // Ignore storage errors.
    }
  }

  getSidebarWidth() {
    try {
      return this.storage.getItem(this.sidebarWidthKey);
    } catch {
      return null;
    }
  }

  setSidebarWidth(width) {
    try {
      this.storage.setItem(this.sidebarWidthKey, String(width));
    } catch {
      // Ignore storage errors.
    }
  }

  getChatNotificationsEnabled() {
    try {
      return this.storage.getItem(this.chatNotificationsKey) === 'true';
    } catch {
      return false;
    }
  }

  setChatNotificationsEnabled(enabled) {
    try {
      this.storage.setItem(this.chatNotificationsKey, String(enabled));
    } catch {
      // Ignore storage errors.
    }
  }
}
