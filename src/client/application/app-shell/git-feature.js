export const gitFeature = {
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

  async stageGitFile(filePath, { scope = 'working-tree' } = {}) {
    if (!filePath) {
      return;
    }

    await this.postGitAction('/api/git/stage', { path: filePath });
    this.toastController.show(`Staged ${this.getDisplayName(filePath)}`);
    await this.refreshGitAfterAction({
      filePath,
      preferredScope: scope === 'all' ? 'all' : 'staged',
    });
  },

  async unstageGitFile(filePath, { scope = 'staged' } = {}) {
    if (!filePath) {
      return;
    }

    await this.postGitAction('/api/git/unstage', { path: filePath });
    this.toastController.show(`Unstaged ${this.getDisplayName(filePath)}`);
    await this.refreshGitAfterAction({
      filePath,
      preferredScope: scope === 'all' ? 'all' : 'working-tree',
    });
  },

  async pushGitBranch() {
    try {
      await this.postGitAction('/api/git/push', {});
      this.toastController.show('Pushed branch');
      await this.refreshGitAfterAction();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to push branch');
    }
  },

  async pullGitBranch() {
    try {
      await this.postGitAction('/api/git/pull', {});
      this.toastController.show('Pulled branch');
      await this.refreshGitAfterAction();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to pull branch');
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
    try {
      const result = await this.postGitAction('/api/git/commit', {
        message,
      });
      dialog.close();
      const shortHash = result.commit?.shortHash ? ` (${result.commit.shortHash})` : '';
      this.toastController.show(`Committed staged changes${shortHash}`);
      await this.refreshGitAfterAction();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to commit staged changes');
    } finally {
      submit?.toggleAttribute('disabled', false);
    }
  },
};
