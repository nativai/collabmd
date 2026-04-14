const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 260;
const KEYBOARD_STEP = 24;

export class SidebarResizerController {
  constructor({ sidebar, resizer, preferences }) {
    this.sidebar = sidebar;
    this.resizer = resizer;
    this.preferences = preferences;
    this._isResizing = false;
    this._startX = 0;
    this._startWidth = 0;
  }

  initialize() {
    if (!this.sidebar || !this.resizer) {
      return;
    }

    this._restoreWidth();
    this._bindMouseEvents();
    this._bindKeyboardEvents();
  }

  syncVisibility(sidebarCollapsed) {
    if (!this.resizer) {
      return;
    }

    this.resizer.classList.toggle('hidden', sidebarCollapsed);

    if (!sidebarCollapsed) {
      this._restoreWidth();
    }
  }

  _restoreWidth() {
    const stored = this.preferences.getSidebarWidth();
    const width = stored != null ? Number(stored) : DEFAULT_WIDTH;
    this._applySidebarWidth(Number.isFinite(width) ? width : DEFAULT_WIDTH);
  }

  _applySidebarWidth(rawWidth) {
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, rawWidth));

    this.sidebar.style.setProperty('--sidebar-width', `${width}px`);
    this.preferences.setSidebarWidth(width);
  }

  _bindMouseEvents() {
    this.resizer.addEventListener('mousedown', (event) => {
      this._isResizing = true;
      this._startX = event.clientX;
      this._startWidth = this.sidebar.offsetWidth;
      this.resizer.classList.add('dragging');
      this.sidebar.style.transition = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!this._isResizing) {
        return;
      }

      const delta = event.clientX - this._startX;
      this._applySidebarWidth(this._startWidth + delta);
    });

    document.addEventListener('mouseup', () => {
      if (!this._isResizing) {
        return;
      }

      this._isResizing = false;
      this.resizer.classList.remove('dragging');
      this.sidebar.style.transition = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  _bindKeyboardEvents() {
    this.resizer.addEventListener('keydown', (event) => {
      const currentWidth = this.sidebar.offsetWidth;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this._applySidebarWidth(currentWidth - KEYBOARD_STEP);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this._applySidebarWidth(currentWidth + KEYBOARD_STEP);
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        this._applySidebarWidth(MIN_WIDTH);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        this._applySidebarWidth(MAX_WIDTH);
      }
    });
  }
}
