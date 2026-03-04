export class LayoutController {
  constructor({ onMeasureEditor }) {
    this.onMeasureEditor = onMeasureEditor;
    this.currentView = 'split';
    this.mobileShowsEditor = true;
    this.editorLayout = document.getElementById('editorLayout');
    this.editorPane = document.getElementById('editorPane');
    this.previewPane = document.getElementById('previewPane');
    this.mobileToggleButton = document.getElementById('mobileViewToggle');
    this.resizer = document.getElementById('resizer');
  }

  initialize() {
    document.querySelectorAll('.view-btn').forEach((button) => {
      button.addEventListener('click', () => this.setView(button.dataset.view));
    });

    this.mobileToggleButton?.addEventListener('click', () => this.toggleMobileView());
    this.initializeResizer();
  }

  reset() {
    this.mobileShowsEditor = true;
    this.updateMobileToggleButton('Preview');
    this.setView('split');

    if (this.editorPane) {
      this.editorPane.style.flex = '';
    }

    if (this.previewPane) {
      this.previewPane.style.flex = '';
    }
  }

  setView(view) {
    this.currentView = view;
    this.editorLayout?.setAttribute('data-view', view);

    document.querySelectorAll('.view-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });

    if (view === 'split' || view === 'editor') {
      this.scheduleEditorMeasure();
    }
  }

  toggleMobileView() {
    this.mobileShowsEditor = !this.mobileShowsEditor;
    this.editorLayout?.setAttribute('data-view', this.mobileShowsEditor ? 'split' : 'preview');
    this.updateMobileToggleButton(this.mobileShowsEditor ? 'Preview' : 'Editor');

    if (this.mobileShowsEditor) {
      this.scheduleEditorMeasure();
    }
  }

  scheduleEditorMeasure() {
    if (!this.onMeasureEditor) {
      return;
    }

    setTimeout(() => this.onMeasureEditor(), 50);
  }

  updateMobileToggleButton(label) {
    if (!this.mobileToggleButton) {
      return;
    }

    const previewIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const editorIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>';

    this.mobileToggleButton.innerHTML = `${label === 'Editor' ? editorIcon : previewIcon}<span class="toolbar-btn-label">${label}</span>`;
  }

  initializeResizer() {
    if (!this.resizer || !this.editorLayout || !this.editorPane || !this.previewPane) {
      return;
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    this.resizer.addEventListener('mousedown', (event) => {
      isResizing = true;
      startX = event.clientX;
      startWidth = this.editorPane.offsetWidth;
      this.resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!isResizing) {
        return;
      }

      const delta = event.clientX - startX;
      const totalWidth = this.editorLayout.offsetWidth;
      const width = Math.max(200, Math.min(totalWidth - 200, startWidth + delta));
      const percentage = (width / totalWidth) * 100;

      this.editorPane.style.flex = `0 0 ${percentage}%`;
      this.previewPane.style.flex = '1';
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) {
        return;
      }

      isResizing = false;
      this.resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.scheduleEditorMeasure();
    });
  }
}
