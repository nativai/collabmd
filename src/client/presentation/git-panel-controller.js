import { escapeHtml } from '../domain/vault-utils.js';

const REFRESH_INTERVAL_MS = 10_000;

function getPathDir(pathValue) {
  const parts = String(pathValue ?? '').split('/');
  parts.pop();
  return parts.join('/');
}

function getPathLeaf(pathValue) {
  return String(pathValue ?? '').split('/').pop() || '';
}

function fileIconSvg() {
  return '<svg class="git-file-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function branchIconSvg() {
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>';
}

function chevronSvg(collapsed) {
  return `<svg class="git-section-chevron${collapsed ? ' collapsed' : ''}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
}

function actionIconSvg(action) {
  switch (action) {
    case 'commit':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    case 'pull':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m18 13-6 6-6-6"/></svg>';
    case 'push':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>';
    case 'unstage':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H8"/><path d="m12 16-4-4 4-4"/></svg>';
    default:
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
  }
}

function badgeClass(status) {
  switch (status) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'untracked':
      return 'untracked';
    default:
      return 'modified';
  }
}

function renderBranchMetrics(summary = {}, branch = {}) {
  const additions = Number(summary.additions || 0);
  const deletions = Number(summary.deletions || 0);
  const changedFiles = Number(summary.changedFiles || 0);

  if (changedFiles > 0 || additions > 0 || deletions > 0) {
    return `
      <span class="git-change-stats" aria-label="Local diff summary">
        <span class="git-change-add">+${additions}</span>
        <span class="git-change-del">-${deletions}</span>
      </span>
    `;
  }

  if (branch.upstream || Number(branch.ahead || 0) > 0 || Number(branch.behind || 0) > 0) {
    return `
      <span class="git-sync-info" aria-label="Remote sync status">
        <span style="color: var(--color-success);">&#8593;${Number(branch.ahead || 0)}</span>
        <span style="color: var(--color-text-faint);">&#8595;${Number(branch.behind || 0)}</span>
      </span>
    `;
  }

  return '<span class="git-sync-info git-sync-info-muted">Clean</span>';
}

export class GitPanelController {
  constructor({
    enabled = true,
    onCommitStaged = () => {},
    onPullBranch = () => {},
    onPushBranch = () => {},
    onRepoChange = () => {},
    onSelectDiff = () => {},
    onStageFile = () => {},
    onUnstageFile = () => {},
    onViewAllDiff = () => {},
    searchInput = null,
    toastController = null,
  } = {}) {
    this.enabled = enabled;
    this.onCommitStaged = onCommitStaged;
    this.onPullBranch = onPullBranch;
    this.onPushBranch = onPushBranch;
    this.onRepoChange = onRepoChange;
    this.onSelectDiff = onSelectDiff;
    this.onStageFile = onStageFile;
    this.onUnstageFile = onUnstageFile;
    this.onViewAllDiff = onViewAllDiff;
    this.searchInput = searchInput;
    this.toastController = toastController;
    this.panel = document.getElementById('gitPanel');
    this.status = null;
    this.active = false;
    this.refreshTimer = null;
    this.searchQuery = '';
    this.collapsedSections = new Set();
    this.selection = {
      path: null,
      scope: null,
    };
    this.pendingActionKey = null;
  }

  initialize() {
    this.panel?.addEventListener('click', (event) => {
      const toggleButton = event.target instanceof Element
        ? event.target.closest('[data-git-section-toggle]')
        : null;
      if (toggleButton) {
        const sectionKey = toggleButton.getAttribute('data-git-section-toggle');
        this.toggleSection(sectionKey);
        return;
      }

      const fileButton = event.target instanceof Element
        ? event.target.closest('[data-git-path]')
        : null;
      if (fileButton && !event.target.closest('[data-git-file-action]')) {
        const filePath = fileButton.getAttribute('data-git-path');
        const scope = fileButton.getAttribute('data-git-scope') || 'working-tree';
        if (!filePath) {
          return;
        }
        this.onSelectDiff(filePath, { scope });
        return;
      }

      const actionButton = event.target instanceof Element
        ? event.target.closest('[data-git-file-action]')
        : null;
      if (actionButton) {
        const action = actionButton.getAttribute('data-git-file-action');
        const filePath = actionButton.getAttribute('data-git-path');
        const scope = actionButton.getAttribute('data-git-scope') || 'working-tree';
        if (!action || !filePath) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void this.handleFileAction(action, filePath, scope);
        return;
      }

      const viewAllButton = event.target instanceof Element
        ? event.target.closest('[data-git-view-all]')
        : null;
      if (viewAllButton) {
        this.onViewAllDiff();
        return;
      }

      const commitStagedButton = event.target instanceof Element
        ? event.target.closest('[data-git-commit-staged]')
        : null;
      if (commitStagedButton) {
        void this.handleCommitStaged();
        return;
      }

      const syncButton = event.target instanceof Element
        ? event.target.closest('[data-git-sync-action]')
        : null;
      if (syncButton) {
        const action = syncButton.getAttribute('data-git-sync-action');
        if (action === 'pull' || action === 'push') {
          void this.handleSyncAction(action);
        }
      }
    });

    this.searchInput?.addEventListener('input', (event) => {
      this.searchQuery = String(event.target?.value ?? '').trim().toLowerCase();
      this.render();
    });
  }

  setActive(active) {
    const nextActive = Boolean(active);
    if (this.active === nextActive && (!nextActive || this.refreshTimer)) {
      return;
    }

    this.active = nextActive;
    if (!this.active) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      return;
    }

    void this.refresh();
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        void this.refresh();
      }, REFRESH_INTERVAL_MS);
    }
  }

  setSelection({ path = null, scope = null } = {}) {
    this.selection = { path, scope };
    this.render();
  }

  toggleSection(sectionKey) {
    if (!sectionKey) {
      return;
    }

    if (this.collapsedSections.has(sectionKey)) {
      this.collapsedSections.delete(sectionKey);
    } else {
      this.collapsedSections.add(sectionKey);
    }
    this.render();
  }

  async refresh({ force = false } = {}) {
    if (!this.enabled) {
      this.status = {
        isGitRepo: false,
        sections: [],
        summary: { changedFiles: 0 },
      };
      this.onRepoChange(false, this.status);
      this.render();
      return this.status;
    }

    try {
      const response = await fetch(`/api/git/status${force ? '?force=true' : ''}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git status');
      }

      this.status = data;
      this.onRepoChange(Boolean(data.isGitRepo), data);
      this.render();
      return data;
    } catch (error) {
      console.error('[git-panel] Failed to load git status:', error);
      this.toastController?.show('Failed to load git status');
      this.status = {
        isGitRepo: false,
        sections: [],
        summary: { changedFiles: 0 },
      };
      this.onRepoChange(false, this.status);
      this.render();
      return this.status;
    }
  }

  filterFiles(files = []) {
    if (!this.searchQuery) {
      return files;
    }

    return files.filter((file) => (
      file.path.toLowerCase().includes(this.searchQuery)
      || String(file.oldPath || '').toLowerCase().includes(this.searchQuery)
    ));
  }

  async handleFileAction(action, filePath, scope) {
    const actionKey = `${action}:${scope}:${filePath}`;
    if (this.pendingActionKey === actionKey) {
      return;
    }

    this.pendingActionKey = actionKey;
    this.render();

    try {
      if (action === 'stage') {
        await this.onStageFile(filePath, { scope });
      } else if (action === 'unstage') {
        await this.onUnstageFile(filePath, { scope });
      }
    } finally {
      this.pendingActionKey = null;
      this.render();
    }
  }

  async handleCommitStaged() {
    const actionKey = 'commit-staged';
    if (this.pendingActionKey === actionKey) {
      return;
    }

    this.pendingActionKey = actionKey;
    this.render();

    try {
      await this.onCommitStaged();
    } finally {
      this.pendingActionKey = null;
      this.render();
    }
  }

  async handleSyncAction(action) {
    const actionKey = `sync:${action}`;
    if (this.pendingActionKey === actionKey) {
      return;
    }

    this.pendingActionKey = actionKey;
    this.render();

    try {
      if (action === 'pull') {
        await this.onPullBranch();
      } else if (action === 'push') {
        await this.onPushBranch();
      }
    } finally {
      this.pendingActionKey = null;
      this.render();
    }
  }

  renderSection(section) {
    const files = this.filterFiles(section.files);
    if (files.length === 0) {
      return '';
    }

    const isCollapsed = this.collapsedSections.has(section.key);

    return `
      <section class="git-section">
        <button class="git-section-header" type="button" data-git-section-toggle="${escapeHtml(section.key)}">
          ${chevronSvg(isCollapsed)}
          ${escapeHtml(section.label)}
          <span class="git-section-count">${files.length}</span>
        </button>
        <div class="git-file-list${isCollapsed ? ' hidden' : ''}">
          ${files.map((file) => this.renderFile(file)).join('')}
        </div>
      </section>
    `;
  }

  renderFile(file) {
    const isActive = this.selection.path === file.path && this.selection.scope === file.scope;
    const dirPath = getPathDir(file.path);
    const displayName = getPathLeaf(file.path);
    const statusClass = badgeClass(file.status);
    const stageAction = file.scope === 'staged'
      ? { label: 'Unstage', value: 'unstage' }
      : { label: 'Stage', value: 'stage' };
    const actionKey = `${stageAction.value}:${file.scope}:${file.path}`;
    const isPending = this.pendingActionKey === actionKey;

    return `
      <div class="git-file-row${isActive ? ' active' : ''}">
        <button
          class="git-file-item${isActive ? ' active' : ''}"
          type="button"
          data-git-path="${escapeHtml(file.path)}"
          data-git-scope="${escapeHtml(file.scope)}"
        >
          ${fileIconSvg()}
          <span class="git-file-copy">
            <span class="git-file-name">${escapeHtml(displayName)}</span>
            ${dirPath ? `<span class="git-file-path">${escapeHtml(dirPath)}</span>` : ''}
          </span>
          <span class="git-status-badge ${statusClass}">${escapeHtml(file.code)}</span>
        </button>
        <div class="git-file-actions">
          <button
            class="git-file-action-btn"
            type="button"
            data-git-file-action="${stageAction.value}"
            data-git-path="${escapeHtml(file.path)}"
            data-git-scope="${escapeHtml(file.scope)}"
            aria-label="${escapeHtml(stageAction.label)} ${escapeHtml(displayName)}"
            title="${escapeHtml(stageAction.label)}"
            ${isPending ? 'disabled' : ''}
          >
            ${isPending ? '...' : actionIconSvg(stageAction.value)}
          </button>
        </div>
      </div>
    `;
  }

  renderEmpty(message) {
    if (!this.panel) {
      return;
    }

    this.panel.innerHTML = `<div class="git-panel-empty">${escapeHtml(message)}</div>`;
  }

  render() {
    if (!this.panel) {
      return;
    }

    if (!this.status) {
      this.renderEmpty('Loading git status...');
      return;
    }

    if (!this.status.isGitRepo) {
      this.renderEmpty('Git is unavailable for this vault.');
      return;
    }

    const branch = this.status.branch ?? {};
    const sectionMarkup = (this.status.sections ?? [])
      .map((section) => this.renderSection(section))
      .filter(Boolean)
      .join('');
    const hasChanges = Boolean(this.status.summary?.changedFiles);
    const hasStagedChanges = Number(this.status.summary?.staged || 0) > 0;
    const isCommitPending = this.pendingActionKey === 'commit-staged';
    const hasUpstream = Boolean(branch.upstream);
    const isPullPending = this.pendingActionKey === 'sync:pull';
    const isPushPending = this.pendingActionKey === 'sync:push';

    this.panel.innerHTML = `
      <div class="git-branch-bar">
        <div class="git-branch-meta">
          <span class="git-branch-name">
            ${branchIconSvg()}
            ${escapeHtml(branch.name || 'HEAD')}
          </span>
          ${renderBranchMetrics(this.status.summary, branch)}
        </div>
        <div class="git-branch-actions" role="group" aria-label="Remote sync actions">
          <button
            class="git-branch-action-btn"
            type="button"
            data-git-sync-action="pull"
            title="${hasUpstream ? 'Pull remote changes (fast-forward only)' : 'No upstream branch configured'}"
            aria-label="Pull branch"
            ${!hasUpstream || isPullPending ? 'disabled' : ''}
          >
            ${isPullPending ? '...' : `${actionIconSvg('pull')}<span>Pull</span>`}
          </button>
          <button
            class="git-branch-action-btn"
            type="button"
            data-git-sync-action="push"
            title="${hasUpstream ? 'Push local commits' : 'No upstream branch configured'}"
            aria-label="Push branch"
            ${!hasUpstream || isPushPending ? 'disabled' : ''}
          >
            ${isPushPending ? '...' : `${actionIconSvg('push')}<span>Push</span>`}
          </button>
        </div>
      </div>
      ${sectionMarkup || '<div class="git-panel-empty">No local changes</div>'}
      ${hasChanges ? `
        <div class="git-panel-footer">
          <div class="git-panel-footer-actions">
            <button class="git-view-all-btn" type="button" data-git-view-all>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View Full Diff
            </button>
            <button
              class="git-footer-commit-btn"
              type="button"
              data-git-commit-staged
              ${!hasStagedChanges || isCommitPending ? 'disabled' : ''}
            >
              ${isCommitPending ? 'Working...' : 'Commit Staged'}
            </button>
          </div>
        </div>
      ` : ''}
    `;
  }
}
