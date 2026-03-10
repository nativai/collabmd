import { escapeHtml } from '../domain/vault-utils.js';

function getPathLeaf(pathValue) {
  return String(pathValue ?? '').split('/').pop() || '';
}

function badgeClass(status) {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left, right, prefixLength) {
  let index = 0;
  const maxLength = Math.min(left.length, right.length) - prefixLength;
  while (index < maxLength) {
    const leftIndex = left.length - 1 - index;
    const rightIndex = right.length - 1 - index;
    if (left[leftIndex] !== right[rightIndex]) {
      break;
    }
    index += 1;
  }
  return index;
}

function highlightPair(leftText, rightText) {
  const prefixLength = commonPrefixLength(leftText, rightText);
  const suffixLength = commonSuffixLength(leftText, rightText, prefixLength);
  const leftChangedEnd = Math.max(prefixLength, leftText.length - suffixLength);
  const rightChangedEnd = Math.max(prefixLength, rightText.length - suffixLength);

  const leftHtml = `${escapeHtml(leftText.slice(0, prefixLength))}${leftChangedEnd > prefixLength ? `<span class="diff-highlight-del">${escapeHtml(leftText.slice(prefixLength, leftChangedEnd))}</span>` : ''}${escapeHtml(leftText.slice(leftChangedEnd))}`;
  const rightHtml = `${escapeHtml(rightText.slice(0, prefixLength))}${rightChangedEnd > prefixLength ? `<span class="diff-highlight-add">${escapeHtml(rightText.slice(prefixLength, rightChangedEnd))}</span>` : ''}${escapeHtml(rightText.slice(rightChangedEnd))}`;

  return { leftHtml, rightHtml };
}

function createPairedBlocks(lines = []) {
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.type === 'context' || line.type === 'note') {
      blocks.push({ additions: [], context: [line], deletions: [] });
      continue;
    }

    if (line.type !== 'deletion' && line.type !== 'addition') {
      continue;
    }

    const deletions = [];
    const additions = [];

    while (index < lines.length && lines[index].type === 'deletion') {
      deletions.push(lines[index]);
      index += 1;
    }

    while (index < lines.length && lines[index].type === 'addition') {
      additions.push(lines[index]);
      index += 1;
    }

    index -= 1;
    blocks.push({ additions, context: [], deletions });
  }

  return blocks;
}

function renderUnifiedLine(line, prefix, contentHtml) {
  const oldLine = Number.isInteger(line.oldLine) ? line.oldLine : '';
  const newLine = Number.isInteger(line.newLine) ? line.newLine : '';
  const lineClass = line.type === 'note' ? 'note' : line.type;
  const renderedPrefix = line.type === 'context' || line.type === 'note' ? ' ' : prefix;

  return `
    <div class="diff-line ${lineClass}">
      <div class="diff-line-numbers">
        <span class="diff-line-num">${oldLine}</span>
        <span class="diff-line-num">${newLine}</span>
      </div>
      <div class="diff-line-prefix">${escapeHtml(renderedPrefix)}</div>
      <div class="diff-line-content">${contentHtml}</div>
    </div>
  `;
}

function renderSplitRow(leftLine, rightLine) {
  let leftHtml = leftLine ? escapeHtml(leftLine.content) : '';
  let rightHtml = rightLine ? escapeHtml(rightLine.content) : '';

  if (leftLine && rightLine && leftLine.type === 'deletion' && rightLine.type === 'addition') {
    const highlighted = highlightPair(leftLine.content, rightLine.content);
    leftHtml = highlighted.leftHtml;
    rightHtml = highlighted.rightHtml;
  }

  return `
    <div class="diff-split-row">
      <div class="diff-split-line ${leftLine?.type || 'empty'}">
        <span class="diff-split-num">${Number.isInteger(leftLine?.oldLine) ? leftLine.oldLine : ''}</span>
        <span class="diff-split-content">${leftHtml}</span>
      </div>
      <div class="diff-split-line ${rightLine?.type || 'empty'}">
        <span class="diff-split-num">${Number.isInteger(rightLine?.newLine) ? rightLine.newLine : ''}</span>
        <span class="diff-split-content">${rightHtml}</span>
      </div>
    </div>
  `;
}

export class GitDiffViewController {
  constructor({
    onCommitStaged = null,
    onOpenFile = null,
    onStageFile = null,
    onUnstageFile = null,
    toastController = null,
  } = {}) {
    this.onCommitStaged = onCommitStaged;
    this.onOpenFile = onOpenFile;
    this.onStageFile = onStageFile;
    this.onUnstageFile = onUnstageFile;
    this.toastController = toastController;
    this.page = document.getElementById('diff-page');
    this.content = document.getElementById('diffContent');
    this.scrollContainer = document.getElementById('diffScroll');
    this.fileIndicator = document.getElementById('diffFileIndicator');
    this.openEditorButton = document.getElementById('diffOpenEditorBtn');
    this.primaryActionButton = document.getElementById('diffPrimaryActionBtn');
    this.commitButton = document.getElementById('diffCommitBtn');
    this.stats = document.getElementById('diffStats');
    this.prevButton = document.getElementById('diffPrevBtn');
    this.nextButton = document.getElementById('diffNextBtn');
    this.modeButtons = Array.from(document.querySelectorAll('[data-diff-mode]'));
    this.mode = 'unified';
    this.data = null;
    this.currentIndex = 0;
    this.fileCache = new Map();
    this.loadingFilePath = null;
    this.requestScope = 'all';
    this.pendingAction = null;
    this.repoStatus = null;
  }

  initialize() {
    this.prevButton?.addEventListener('click', () => this.navigateFile(-1));
    this.nextButton?.addEventListener('click', () => this.navigateFile(1));
    this.openEditorButton?.addEventListener('click', () => {
      const currentFile = this.getCurrentFile();
      if (!currentFile?.path) {
        return;
      }

      this.onOpenFile?.(currentFile.path);
    });
    this.primaryActionButton?.addEventListener('click', () => {
      const action = this.getPrimaryAction();
      if (!action) {
        return;
      }

      void this.handleFileAction(action);
    });
    this.commitButton?.addEventListener('click', () => {
      void this.handleFileAction('commit');
    });
    this.content?.addEventListener('click', (event) => {
      const loadButton = event.target instanceof Element
        ? event.target.closest('[data-load-full-diff]')
        : null;
      if (loadButton) {
        void this.loadCurrentFile({ forceFullPatch: true });
      }
    });
    this.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.getAttribute('data-diff-mode');
        if (!nextMode || nextMode === this.mode) {
          return;
        }
        this.mode = nextMode;
        this.render();
      });
    });
  }

  hide() {
    this.page?.classList.add('hidden');
    if (this.content) {
      this.content.innerHTML = '';
    }
    this.data = null;
    this.currentIndex = 0;
    this.fileCache.clear();
    this.loadingFilePath = null;
    this.pendingAction = null;
    this.repoStatus = null;
    this.syncToolbar();
  }

  async open({ filePath = null, scope = 'all' } = {}) {
    this.fileCache.clear();
    this.loadingFilePath = null;
    this.requestScope = scope;
    this.renderLoading('Loading diff summary...');

    try {
      const query = new URLSearchParams();
      query.set('scope', scope);
      if (filePath) {
        query.set('path', filePath);
      }
      query.set('metaOnly', 'true');

      const response = await fetch(`/api/git/diff?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git diff');
      }

      this.data = data;
      const initialIndex = filePath
        ? Math.max(0, data.files.findIndex((file) => file.path === filePath))
        : 0;
      this.currentIndex = initialIndex;
      if ((data.files?.length ?? 0) === 0) {
        this.render();
        return data;
      }

      await this.loadCurrentFile();
      return data;
    } catch (error) {
      console.error('[git-diff] Failed to load diff:', error);
      this.toastController?.show('Failed to load git diff');
      this.data = {
        files: [],
        metaOnly: false,
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
      };
      this.renderEmpty('Failed to load git diff');
      return this.data;
    }
  }

  navigateFile(direction) {
    if (!this.data?.files?.length) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(this.currentIndex + direction, this.data.files.length - 1));
    if (nextIndex === this.currentIndex) {
      return;
    }

    this.currentIndex = nextIndex;
    this.scrollContainer?.scrollTo({ top: 0, behavior: 'auto' });
    void this.loadCurrentFile();
  }

  renderLoading(message = 'Loading git diff...') {
    this.page?.classList.remove('hidden');
    if (this.content) {
      this.content.innerHTML = `<div class="diff-empty-state">${escapeHtml(message)}</div>`;
    }
    this.data = null;
    this.syncToolbar();
  }

  renderEmpty(message) {
    this.page?.classList.remove('hidden');
    if (this.content) {
      this.content.innerHTML = `<div class="diff-empty-state">${escapeHtml(message)}</div>`;
    }
    this.syncToolbar();
  }

  renderUnifiedHunk(hunk) {
    const markup = [];
    for (const block of createPairedBlocks(hunk.lines)) {
      if (block.context.length > 0) {
        for (const line of block.context) {
          markup.push(renderUnifiedLine(line, ' ', escapeHtml(line.content)));
        }
        continue;
      }

      const pairCount = Math.max(block.deletions.length, block.additions.length);
      for (let index = 0; index < pairCount; index += 1) {
        const deletion = block.deletions[index] ?? null;
        const addition = block.additions[index] ?? null;
        const highlighted = deletion && addition
          ? highlightPair(deletion.content, addition.content)
          : null;

        if (deletion) {
          markup.push(renderUnifiedLine(deletion, '-', highlighted?.leftHtml ?? escapeHtml(deletion.content)));
        }

        if (addition) {
          markup.push(renderUnifiedLine(addition, '+', highlighted?.rightHtml ?? escapeHtml(addition.content)));
        }
      }
    }

    return `
      <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
      ${markup.join('')}
    `;
  }

  renderUnifiedFile(file, index) {
    return `
      <section class="diff-file-block" data-diff-file-index="${index}">
        <div class="diff-file-header">
          <span class="diff-file-path">${escapeHtml(file.path)}</span>
          <span class="git-status-badge ${badgeClass(file.status)}">${escapeHtml(file.status)}</span>
          <span class="diff-file-header-stats"><span class="diff-stats-add">+${file.stats?.additions ?? 0}</span><span class="diff-stats-del">-${file.stats?.deletions ?? 0}</span></span>
        </div>
        ${file.isBinary ? `<div class="diff-binary-message">${escapeHtml(file.binaryMessage || 'Binary file changed')}</div>` : ''}
        ${file.hunks.map((hunk) => this.renderUnifiedHunk(hunk)).join('')}
      </section>
    `;
  }

  renderSplitFile(file, index) {
    const hunks = file.hunks.map((hunk) => {
      const rows = [];
      for (const block of createPairedBlocks(hunk.lines)) {
        if (block.context.length > 0) {
          for (const line of block.context) {
            rows.push(renderSplitRow(line, line));
          }
          continue;
        }

        const count = Math.max(block.deletions.length, block.additions.length);
        for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
          rows.push(renderSplitRow(block.deletions[rowIndex] ?? null, block.additions[rowIndex] ?? null));
        }
      }

      return `
        <div class="diff-split-hunk">${escapeHtml(hunk.header)}</div>
        ${rows.join('')}
      `;
    }).join('');

    return `
      <section class="diff-file-block" data-diff-file-index="${index}">
        <div class="diff-file-header">
          <span class="diff-file-path">${escapeHtml(file.path)}</span>
          <span class="git-status-badge ${badgeClass(file.status)}">${escapeHtml(file.status)}</span>
          <span class="diff-file-header-stats"><span class="diff-stats-add">+${file.stats?.additions ?? 0}</span><span class="diff-stats-del">-${file.stats?.deletions ?? 0}</span></span>
        </div>
        <div class="diff-split">
          <div class="diff-split-pane">
            <div class="diff-split-pane-header">Before</div>
            ${hunks}
          </div>
        </div>
      </section>
    `;
  }

  getCurrentFile() {
    const files = this.data?.files ?? [];
    if (files.length === 0) {
      return null;
    }

    return files[this.currentIndex] ?? files[0] ?? null;
  }

  getCurrentCacheKey() {
    const currentFile = this.getCurrentFile();
    return currentFile?.path ? `${this.requestScope}:${currentFile.path}` : null;
  }

  getCurrentFileDetail() {
    const cacheKey = this.getCurrentCacheKey();
    return cacheKey ? this.fileCache.get(cacheKey) : null;
  }

  getCurrentActionState() {
    const currentFile = this.getCurrentFile();
    const detail = this.getCurrentFileDetail() ?? currentFile;
    const stagedCount = Number(this.repoStatus?.summary?.staged || 0);
    if (!detail?.path) {
      return {
        canCommit: stagedCount > 0,
        canStage: false,
        canUnstage: false,
      };
    }

    return {
      canCommit: stagedCount > 0,
      canStage: Boolean(detail.hasWorkingTreeChanges || detail.hasUntrackedChanges),
      canUnstage: Boolean(detail.hasStagedChanges),
    };
  }

  getPrimaryAction() {
    const actionState = this.getCurrentActionState();
    if (actionState.canStage && !actionState.canUnstage) {
      return 'stage';
    }
    if (actionState.canUnstage && !actionState.canStage) {
      return 'unstage';
    }
    if (this.requestScope === 'staged' && actionState.canUnstage) {
      return 'unstage';
    }
    if (actionState.canStage) {
      return 'stage';
    }
    if (actionState.canUnstage) {
      return 'unstage';
    }
    return null;
  }

  async handleFileAction(action) {
    const currentFile = this.getCurrentFile();
    if (!currentFile?.path || this.pendingAction) {
      return;
    }

    this.pendingAction = action;
    this.syncToolbar();

    try {
      if (action === 'stage') {
        await this.onStageFile?.(currentFile.path, { scope: this.requestScope });
      } else if (action === 'unstage') {
        await this.onUnstageFile?.(currentFile.path, { scope: this.requestScope });
      } else if (action === 'commit') {
        await this.onCommitStaged?.();
      }
    } finally {
      this.pendingAction = null;
      this.syncToolbar();
    }
  }

  setRepoStatus(status) {
    this.repoStatus = status;
    this.syncToolbar();
  }

  async loadCurrentFile({ forceFullPatch = false } = {}) {
    const currentFile = this.getCurrentFile();
    if (!currentFile?.path) {
      this.render();
      return null;
    }

    const cacheKey = this.getCurrentCacheKey();
    const cachedFile = cacheKey ? this.fileCache.get(cacheKey) : null;
    if (cachedFile && (!cachedFile.tooLarge || !forceFullPatch)) {
      this.loadingFilePath = null;
      this.render();
      return cachedFile;
    }

    this.loadingFilePath = currentFile.path;
    this.render();

    try {
      const query = new URLSearchParams();
      query.set('scope', this.requestScope);
      query.set('path', currentFile.path);
      if (forceFullPatch) {
        query.set('allowLargePatch', 'true');
      }

      const response = await fetch(`/api/git/diff?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load file diff');
      }

      const detail = {
        ...currentFile,
        ...(data.files?.[0] ?? {}),
      };
      if (cacheKey) {
        this.fileCache.set(cacheKey, detail);
      }
      this.loadingFilePath = null;
      this.render();
      return detail;
    } catch (error) {
      console.error('[git-diff] Failed to load file diff:', error);
      this.toastController?.show('Failed to load file diff');
      this.loadingFilePath = null;
      this.render();
      return null;
    }
  }

  renderCurrentFile() {
    const currentFile = this.getCurrentFile();
    if (!currentFile) {
      return '<div class="diff-empty-state">No changes to display.</div>';
    }

    const detail = this.getCurrentFileDetail();
    if (this.loadingFilePath === currentFile.path) {
      return `
        <section class="diff-file-block">
          <div class="diff-file-header">
            <span class="diff-file-path">${escapeHtml(currentFile.path)}</span>
            <span class="git-status-badge ${badgeClass(currentFile.status)}">${escapeHtml(currentFile.status)}</span>
          </div>
          <div class="diff-empty-state">Loading file diff...</div>
        </section>
      `;
    }

    if (!detail) {
      return `
        <section class="diff-file-block">
          <div class="diff-file-header">
            <span class="diff-file-path">${escapeHtml(currentFile.path)}</span>
            <span class="git-status-badge ${badgeClass(currentFile.status)}">${escapeHtml(currentFile.status)}</span>
          </div>
          <div class="diff-empty-state">Select a file to load its diff.</div>
        </section>
      `;
    }

    if (detail.tooLarge) {
      return `
        <section class="diff-file-block">
          <div class="diff-file-header">
            <span class="diff-file-path">${escapeHtml(detail.path)}</span>
            <span class="git-status-badge ${badgeClass(detail.status)}">${escapeHtml(detail.status)}</span>
            <span class="diff-file-header-stats"><span class="diff-stats-add">+${detail.stats?.additions ?? 0}</span><span class="diff-stats-del">-${detail.stats?.deletions ?? 0}</span></span>
          </div>
          <div class="diff-limit-card">
            <strong>Large diff withheld</strong>
            <span>This file diff is large enough to impact rendering performance.</span>
            <button class="btn btn-secondary diff-load-full-btn" type="button" data-load-full-diff>Load full diff</button>
          </div>
        </section>
      `;
    }

    return this.mode === 'split'
      ? this.renderSplitFile(detail, this.currentIndex)
      : this.renderUnifiedFile(detail, this.currentIndex);
  }

  syncToolbar() {
    const totalFiles = this.data?.files?.length ?? 0;
    const visibleIndex = totalFiles === 0 ? 0 : this.currentIndex + 1;
    if (this.fileIndicator) {
      this.fileIndicator.textContent = totalFiles > 0
        ? `${visibleIndex} / ${totalFiles} files`
        : '0 / 0 files';
    }

    if (this.stats) {
      const additions = this.data?.summary?.additions ?? 0;
      const deletions = this.data?.summary?.deletions ?? 0;
      this.stats.innerHTML = `
        <span class="diff-stats-add">+${additions}</span>
        <span class="diff-stats-del">-${deletions}</span>
      `;
    }

    this.modeButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-diff-mode') === this.mode);
    });
    const hasCurrentFile = Boolean(this.getCurrentFile()?.path);
    const actionState = this.getCurrentActionState();
    const primaryAction = this.getPrimaryAction();
    this.openEditorButton?.toggleAttribute('disabled', !hasCurrentFile);
    if (this.primaryActionButton) {
      this.primaryActionButton.textContent = this.pendingAction === primaryAction
        ? 'Working...'
        : primaryAction === 'unstage'
          ? 'Unstage'
          : 'Stage';
      this.primaryActionButton.toggleAttribute(
        'disabled',
        !hasCurrentFile || !primaryAction || Boolean(this.pendingAction),
      );
    }
    if (this.commitButton) {
      this.commitButton.textContent = this.pendingAction === 'commit' ? 'Working...' : 'Commit Staged';
    }
    this.commitButton?.toggleAttribute(
      'disabled',
      !actionState.canCommit || Boolean(this.pendingAction),
    );
    this.prevButton?.toggleAttribute('disabled', this.currentIndex <= 0);
    this.nextButton?.toggleAttribute('disabled', totalFiles === 0 || this.currentIndex >= totalFiles - 1);
  }

  render() {
    this.page?.classList.remove('hidden');

    const files = this.data?.files ?? [];
    if (files.length === 0) {
      this.renderEmpty('No changes to display.');
      return;
    }

    if (!this.content) {
      return;
    }

    this.content.innerHTML = this.renderCurrentFile();
    this.syncToolbar();
  }

  getToolbarTitle({ filePath = null, scope = 'all' } = {}) {
    if (filePath) {
      return getPathLeaf(filePath);
    }

    if (scope === 'staged') {
      return 'Staged Changes';
    }

    if (scope === 'working-tree') {
      return 'Working Tree Changes';
    }

    return 'All Changes';
  }
}
