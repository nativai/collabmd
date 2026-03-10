export class BrowserNotificationPort {
  constructor({
    NotificationImpl = globalThis.Notification,
    focusWindow = () => globalThis.window?.focus?.(),
  } = {}) {
    this.NotificationImpl = NotificationImpl;
    this.focusWindow = focusWindow;
  }

  getPermission() {
    if (typeof this.NotificationImpl !== 'function') {
      return 'unsupported';
    }

    return this.NotificationImpl.permission;
  }

  async requestPermission() {
    if (typeof this.NotificationImpl !== 'function') {
      return 'unsupported';
    }

    return this.NotificationImpl.requestPermission();
  }

  createNotification({ body, onClick, tag, title }) {
    if (typeof this.NotificationImpl !== 'function') {
      return null;
    }

    const notification = new this.NotificationImpl(title, { body, tag });
    if (typeof onClick === 'function') {
      notification.addEventListener('click', () => {
        this.focusWindow();
        onClick();
      });
    }
    return notification;
  }
}
