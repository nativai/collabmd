import { resolveApiUrl } from '../../domain/runtime-paths.js';

function normalizeWorkspaceChange(workspaceChange = {}) {
  return {
    changedPaths: Array.isArray(workspaceChange.changedPaths) ? workspaceChange.changedPaths.filter(Boolean) : [],
    deletedPaths: Array.isArray(workspaceChange.deletedPaths) ? workspaceChange.deletedPaths.filter(Boolean) : [],
    refreshExplorer: workspaceChange.refreshExplorer !== false,
    renamedPaths: Array.isArray(workspaceChange.renamedPaths)
      ? workspaceChange.renamedPaths.filter((entry) => entry?.oldPath && entry?.newPath)
      : [],
  };
}

export const gitFeature = {
  setGitOperationStatus(message = '') {
    const badge = this.elements.gitOperationStatus;
    if (!badge) {
      return;
    }

    const text = String(message ?? '').trim();
    badge.textContent = text;
    badge.classList.toggle('hidden', !text);
  },

  async runGitActionWithStatus(message, callback) {
    this.setGitOperationStatus(message);
    try {
      return await callback();
    } finally {
      this.setGitOperationStatus('');
    }
  },

  handleGitDiffSelection(filePath, { closeSidebarOnMobile = false, scope = 'working-tree' } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    this.navigation.navigateToGitDiff({ filePath, scope });
  },

  handleGitRepoChange(isGitRepo, status = null) {
    this.gitRepoAvailable = Boolean(isGitRepo);
    this.elements.sidebarTabs?.classList.toggle('hidden', !this.gitRepoAvailable);
    this.elements.gitSidebarTab?.classList.toggle('hidden', !this.gitRepoAvailable);
    
    const hasChanges = isGitRepo && status?.summary?.changedFiles > 0;
    this.elements.gitSidebarTab?.classList.toggle('has-changes', hasChanges);
    
    this.gitDiffView.setRepoStatus(this.gitRepoAvailable ? status : null);

    if (!this.gitRepoAvailable && this.activeSidebarTab === 'git') {
      this.setSidebarTab('files');
      return;
    }

    if (this.gitRepoAvailable && this.navigation.getHashRoute().type === 'git-diff' && this.activeSidebarTab !== 'git') {
      this.setSidebarTab('git');
    }
  },

  syncMainChrome({ mode, title = null } = {}) {
    const isDiffMode = mode === 'diff';
    this.elements.toolbarCenter?.classList.toggle('hidden', isDiffMode);
    this.elements.mobileViewToggle?.classList.toggle('hidden', isDiffMode);
    this.elements.userCount?.classList.toggle('hidden', isDiffMode);
    this.elements.toolbarDiffBadge?.classList.toggle('hidden', !isDiffMode);

    if (title && this.elements.activeFileName) {
      this.elements.activeFileName.textContent = title;
    }
  },

  async showGitDiff({ filePath = null, scope = 'all' } = {}) {
    this.gitPanel.setSelection(filePath ? { path: filePath, scope } : {});
    this.showDiffState();
    this.syncMainChrome({
      mode: 'diff',
      title: this.gitDiffView.getToolbarTitle({ filePath, scope }),
    });
    await this.gitDiffView.open({ filePath, scope });
  },

  async postGitAction(endpoint, payload) {
    const response = await fetch(endpoint, {
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Git action failed');
    }
    return data;
  },

  async refreshWorkspaceAfterGitAction({ filePath = null, preferredScope = null } = {}) {
    await this.fileExplorer.refresh();
    await this.refreshGitAfterAction({ filePath, preferredScope });
  },

  async refreshGitAfterAction({ filePath = null, preferredScope = null } = {}) {
    await this.gitPanel.refresh({ force: true });

    const route = this.navigation.getHashRoute();
    if (route.type !== 'git-diff') {
      return;
    }

    const nextFilePath = filePath ?? route.filePath;
    const nextScope = preferredScope ?? route.scope;
    if (nextScope !== route.scope || nextFilePath !== route.filePath) {
      this.navigation.navigateToGitDiff({ filePath: nextFilePath, scope: nextScope });
      return;
    }

    await this.showGitDiff({ filePath: route.filePath, scope: route.scope });
  },

  async finalizeGitAction({
    action,
    filePath = null,
    preferredScope = null,
    result = {},
    showLocalFileToast = false,
  } = {}) {
    const workspaceChange = normalizeWorkspaceChange(result.workspaceChange);
    await this.refreshWorkspaceAfterGitAction({ filePath, preferredScope });
    this.handleWorkspaceChangeForCurrentFile(workspaceChange, { action, local: true, showToast: showLocalFileToast });
    this.lobby.sendWorkspaceEvent({
      action,
      sourceRef: result.sourceRef ?? null,
      workspaceChange,
    });
    return workspaceChange;
  },

  handleWorkspaceChangeForCurrentFile(workspaceChange, { action = 'git', local = false, showToast = true } = {}) {
    const currentFilePath = this.currentFilePath;
    if (!currentFilePath) {
      return false;
    }

    const wasDeleted = workspaceChange.deletedPaths.includes(currentFilePath);
    const renameEntry = workspaceChange.renamedPaths.find((entry) => entry.oldPath === currentFilePath);
    if (!wasDeleted && !renameEntry) {
      return false;
    }

    this.navigation.navigateToFile(null);
    if (!showToast) {
      return true;
    }

    const displayName = this.getDisplayName(currentFilePath);
    if (renameEntry) {
      this.toastController.show(
        local
          ? `${displayName} was reset away from this branch path`
          : `${displayName} moved after a ${action} operation`,
      );
      return true;
    }

    this.toastController.show(
      local
        ? `${displayName} was removed by ${action}`
        : `${displayName} was removed after a ${action} operation`,
    );
    return true;
  },

  async handleIncomingWorkspaceEvent(event) {
    if (!this.isTabActive || !event) {
      return;
    }

    const workspaceChange = normalizeWorkspaceChange(event.workspaceChange);
    await this.refreshWorkspaceAfterGitAction();
    this.handleWorkspaceChangeForCurrentFile(workspaceChange, {
      action: event.action || 'git',
      local: false,
      showToast: true,
    });
  },

  async stageGitFile(filePath, { scope = 'working-tree' } = {}) {
    if (!filePath) {
      return;
    }

    await this.runGitActionWithStatus('Staging changes...', async () => {
      const result = await this.postGitAction(resolveApiUrl('/git/stage'), { path: filePath });
      await this.finalizeGitAction({
        action: 'stage',
        filePath,
        preferredScope: scope === 'all' ? 'all' : 'staged',
        result,
      });
    });
  },

  async unstageGitFile(filePath, { scope = 'staged' } = {}) {
    if (!filePath) {
      return;
    }

    await this.runGitActionWithStatus('Unstaging changes...', async () => {
      const result = await this.postGitAction(resolveApiUrl('/git/unstage'), { path: filePath });
      await this.finalizeGitAction({
        action: 'unstage',
        filePath,
        preferredScope: scope === 'all' ? 'all' : 'working-tree',
        result,
      });
    });
  },

  async pushGitBranch() {
    await this.runGitActionWithStatus('Pushing branch...', async () => {
      try {
        const result = await this.postGitAction(resolveApiUrl('/git/push'), {});
        await this.finalizeGitAction({
          action: 'push',
          result,
        });
      } catch (error) {
        this.toastController.show(error.message || 'Failed to push branch');
      }
    });
  },

  async pullGitBranch() {
    await this.runGitActionWithStatus('Pulling branch...', async () => {
      try {
        const result = await this.postGitAction(resolveApiUrl('/git/pull'), {});
        await this.finalizeGitAction({
          action: 'pull',
          result,
          showLocalFileToast: true,
        });
      } catch (error) {
        this.toastController.show(error.message || 'Failed to pull branch');
      }
    });
  },

  openGitResetDialog(filePath) {
    if (!this.isTabActive || !filePath) {
      return;
    }

    const dialog = this.elements.gitResetDialog;
    if (!dialog || !this.elements.gitResetFileName) {
      return;
    }

    this.pendingGitResetPath = filePath;
    if (this.elements.gitResetTitle) {
      this.elements.gitResetTitle.textContent = 'Reset file to current branch';
    }
    if (this.elements.gitResetCopy) {
      this.elements.gitResetCopy.textContent = 'Restore this file from the current checked-out branch. If this branch does not contain the file, the file will be deleted locally.';
    }
    this.elements.gitResetFileName.value = filePath;
    if (this.elements.gitResetSubmit) {
      this.elements.gitResetSubmit.textContent = 'Reset File';
    }
    this.elements.gitResetSubmit?.toggleAttribute('disabled', false);

    if (dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
  },

  async handleGitResetSubmit() {
    const filePath = this.pendingGitResetPath;
    const dialog = this.elements.gitResetDialog;
    const submit = this.elements.gitResetSubmit;
    if (!filePath || !dialog) {
      return;
    }

    submit?.toggleAttribute('disabled', true);
    if (submit) {
      submit.textContent = 'Resetting...';
    }
    try {
      await this.runGitActionWithStatus('Resetting file...', async () => {
        const result = await this.postGitAction(resolveApiUrl('/git/reset-file'), { path: filePath });
        await this.finalizeGitAction({
          action: 'reset',
          filePath,
          result,
          showLocalFileToast: true,
        });
      });
      dialog.close();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to reset file');
    } finally {
      if (submit) {
        submit.textContent = 'Reset File';
      }
      submit?.toggleAttribute('disabled', false);
    }
  },

  openGitCommitDialog() {
    if (!this.isTabActive) {
      return;
    }

    const dialog = this.elements.gitCommitDialog;
    const input = this.elements.gitCommitInput;
    if (!dialog || !input) {
      return;
    }

    if (this.elements.gitCommitTitle) {
      this.elements.gitCommitTitle.textContent = 'Commit staged changes';
    }
    if (this.elements.gitCommitCopy) {
      const stagedCount = Number(this.gitPanel.status?.summary?.staged || 0);
      this.elements.gitCommitCopy.textContent = stagedCount > 0
        ? `${stagedCount} staged file${stagedCount === 1 ? '' : 's'} will be included.`
        : 'All staged changes will be included.';
    }
    if (this.elements.gitCommitSubmit) {
      this.elements.gitCommitSubmit.textContent = 'Commit staged changes';
    }
    input.value = '';

    if (dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  },

  async handleGitCommitSubmit() {
    const dialog = this.elements.gitCommitDialog;
    const input = this.elements.gitCommitInput;
    const submit = this.elements.gitCommitSubmit;
    const message = String(input?.value ?? '').trim();
    if (!dialog || !input) {
      return;
    }
    if (!message) {
      input.focus();
      this.toastController.show('Commit message cannot be empty');
      return;
    }

    submit?.toggleAttribute('disabled', true);
    if (submit) {
      submit.textContent = 'Committing...';
    }
    try {
      await this.runGitActionWithStatus('Committing changes...', async () => {
        const result = await this.postGitAction(resolveApiUrl('/git/commit'), {
          message,
        });
        await this.finalizeGitAction({
          action: 'commit',
          result,
        });
      });
      dialog.close();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to commit staged changes');
    } finally {
      if (submit) {
        submit.textContent = 'Commit staged changes';
      }
      submit?.toggleAttribute('disabled', false);
    }
  },
};
