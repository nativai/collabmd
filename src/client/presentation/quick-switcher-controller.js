import { stripVaultFileExtension } from '../../domain/file-kind.js';
import { escapeHtml } from '../domain/vault-utils.js';
import {
  DEFAULT_SEARCH_DEBOUNCE_MS,
  QuickSwitcherTextSearchRunner,
  flattenTextResults,
  formatMatchCount,
} from './quick-switcher-text-search.js';
import { QuickSwitcherWisdomSearchRunner } from './quick-switcher-wisdom-search.js';

const MAX_VISIBLE_RESULTS = 12;
const WISDOM_MODE = 'wisdom';
const WISDOM_EMPTY_HINT = 'Press Enter to search the meaning of your whole vault.';
const WISDOM_EMPTY_SUBHINT = 'Semantic search reads intent, not just keywords — it takes a few seconds.';
const WISDOM_ARMED_HINT = 'Press Enter to search the meaning of your whole vault.';

function stripDisplayExtension(filePath) {
  return stripVaultFileExtension(filePath);
}

function createCorpusEntry(filePath) {
  const displayName = stripDisplayExtension(filePath);
  const fileName = displayName.split('/').pop() || displayName;

  return {
    displayName,
    fileName,
    filePath,
    lowerDisplayName: displayName.toLowerCase(),
    lowerFileName: fileName.toLowerCase(),
    lowerPath: String(filePath).toLowerCase(),
  };
}

function getFileName(filePath) {
  return stripDisplayExtension(filePath).split('/').pop() || stripDisplayExtension(filePath);
}

function getDirPath(filePath) {
  const displayName = stripDisplayExtension(filePath);
  return displayName.includes('/') ? displayName.substring(0, displayName.lastIndexOf('/')) : '';
}

export class QuickSwitcherController {
  constructor({
    getFileList,
    getSearchConfig = () => ({}),
    getWisdomSearchConfig = () => ({}),
    onFileSelect,
    onTextMatchSelect = null,
    searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
    searchText = null,
    wisdomSearch = null,
  }) {
    this.getFileList = getFileList;
    this.getSearchConfig = getSearchConfig;
    this.getWisdomSearchConfig = getWisdomSearchConfig;
    this.onFileSelect = onFileSelect;
    this.onTextMatchSelect = onTextMatchSelect;
    this.searchDebounceMs = searchDebounceMs;
    this.searchText = searchText;
    this.wisdomSearch = wisdomSearch;

    this.overlay = document.getElementById('quickSwitcher');
    this.input = document.getElementById('quickSwitcherInput');
    this.resultsList = document.getElementById('quickSwitcherResults');
    this.hint = document.getElementById('quickSwitcherHint');
    this.modeTabs = Array.from(document.querySelectorAll?.('[data-qs-mode]') ?? []);

    this.filteredFiles = [];
    this.fileMatchTotal = 0;
    this.fileCorpus = [];
    this.lastFileListRef = null;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.isOpen = false;
    this.mode = 'files';
    this.contentFallbackActive = false;
    this.textResults = null;
    this.textResultItems = [];
    this.textSearchRunner = new QuickSwitcherTextSearchRunner({
      debounceMs: this.searchDebounceMs,
    });

    // Wisdom mode (submit-driven, progressive lex-preview → full replace).
    this.wisdomResults = null;
    this.wisdomResultItems = [];
    this.selectedWisdomIndex = 0;
    this.wisdomProvisional = false;
    this.wisdomStopped = false;
    this.wisdomLoading = false;
    this.wisdomLastRunQuery = null;
    this.wisdomProgressCopy = '';
    this.armedChip = null;
    this.wisdomSearchRunner = new QuickSwitcherWisdomSearchRunner();

    this._ensureWisdomChrome();
    this.bindEvents();
  }

  _ensureWisdomChrome() {
    if (!this.input || this.armedChip) {
      return;
    }
    const wrap = this.input.parentElement;
    if (!wrap) {
      return;
    }
    const chip = document.createElement('kbd');
    chip.className = 'qs-kbd enter hidden';
    chip.textContent = '↵ Enter';
    const escChip = wrap.querySelector('.qs-kbd');
    if (escChip) {
      wrap.insertBefore(chip, escChip);
    } else {
      wrap.appendChild(chip);
    }
    this.armedChip = chip;
  }

  updateArmedChip(show) {
    this.armedChip?.classList.toggle('hidden', !show);
  }

  _bindModeTab(tab) {
    tab.addEventListener('click', () => {
      this.setMode(tab.dataset.qsMode, { preserveInput: true });
    });
  }

  /**
   * Re-scan the DOM for mode tabs and wire any that appeared after construction. The Wisdom
   * tab can be inserted live once the co-located engine becomes reachable (brick 25ce51f0),
   * after this controller was already built on the first ⌘K. Idempotent: already-wired tabs
   * are skipped, so it is safe to call repeatedly.
   */
  syncModeTabs() {
    const tabs = Array.from(document.querySelectorAll?.('[data-qs-mode]') ?? []);
    for (const tab of tabs) {
      if (this.modeTabs.includes(tab)) {
        continue;
      }
      this._bindModeTab(tab);
      this.modeTabs.push(tab);
    }
  }

  bindEvents() {
    this.overlay?.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.modeTabs.forEach((tab) => {
      this._bindModeTab(tab);
    });

    this.input?.addEventListener('input', () => {
      this.handleInput();
    });

    this.input?.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          this.confirmSelection();
          break;
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
        case 'Tab':
          e.preventDefault();
          if (this.modeTabs.length > 1) {
            this.cycleMode(e.shiftKey ? -1 : 1);
          } else {
            this.moveSelection(e.shiftKey ? -1 : 1);
          }
          break;
      }
    });
  }

  open() {
    if (!this.overlay) return;

    this.isOpen = true;
    this.input.value = '';
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.overlay.classList.add('visible');
    this.setMode('files', { preserveInput: true });

    // The overlay transitions visibility hidden→visible over 120ms.
    // Browsers ignore .focus() while the element is still visibility:hidden,
    // so we must wait for the transition to complete.
    this._focusAfterTransition();
  }

  /** Focus the input once the overlay visibility transition finishes. */
  _focusAfterTransition() {
    this._cancelPendingFocus();

    const tryFocus = () => {
      this._focusCleanup = null;
      this.input?.focus();
      if (this.isOpen && this.input && document.activeElement !== this.input) {
        setTimeout(() => this.input?.focus(), 50);
      }
    };

    const onEnd = (e) => {
      if (e.propertyName === 'visibility' || e.propertyName === 'opacity') {
        this.overlay.removeEventListener('transitionend', onEnd);
        clearTimeout(fallbackTimer);
        tryFocus();
      }
    };
    this.overlay.addEventListener('transitionend', onEnd);

    const fallbackTimer = setTimeout(() => {
      this.overlay.removeEventListener('transitionend', onEnd);
      tryFocus();
    }, 160);

    this._focusCleanup = () => {
      this.overlay.removeEventListener('transitionend', onEnd);
      clearTimeout(fallbackTimer);
    };
  }

  _cancelPendingFocus() {
    if (this._focusCleanup) {
      this._focusCleanup();
      this._focusCleanup = null;
    }
  }

  close() {
    if (!this.overlay) return;

    this._cancelPendingFocus();
    this.abortTextSearch();
    this.abortWisdomSearch();
    this.updateArmedChip(false);
    this.isOpen = false;
    this.overlay.classList.remove('visible');
    this.input.value = '';
    this.resultsList.innerHTML = '';
  }

  cycleMode(delta = 1) {
    const modes = this.modeTabs.map((tab) => tab.dataset.qsMode).filter(Boolean);
    if (modes.length < 2) {
      return;
    }
    const currentIndex = Math.max(modes.indexOf(this.mode), 0);
    const nextMode = modes[(currentIndex + delta + modes.length) % modes.length];
    this.setMode(nextMode, { preserveInput: true });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  setMode(mode = 'files', { preserveInput = false } = {}) {
    const normalizedMode = (mode === 'text' || mode === WISDOM_MODE) ? mode : 'files';
    this.mode = normalizedMode;
    this.contentFallbackActive = false;
    this.selectedIndex = 0;
    this.selectedTextIndex = 0;
    this.selectedWisdomIndex = 0;

    // Leaving a mode cancels its in-flight work so a stale result can't paint later.
    this.abortTextSearch();
    this.abortWisdomSearch();

    if (!preserveInput && this.input) {
      this.input.value = '';
    }

    this.modeTabs.forEach((tab) => {
      const isActive = tab.dataset.qsMode === normalizedMode;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (this.input) {
      if (normalizedMode === 'text') {
        this.input.placeholder = 'Search text in files...';
      } else if (normalizedMode === WISDOM_MODE) {
        this.input.placeholder = 'Search the meaning of your whole vault — press Enter';
      } else {
        this.input.placeholder = 'Search files...';
      }
    }

    this.handleInput();
  }

  handleInput() {
    if (this.mode === 'text') {
      this.abortWisdomSearch();
      this.updateArmedChip(false);
      this.scheduleTextSearch();
      return;
    }

    if (this.mode === WISDOM_MODE) {
      this.abortTextSearch();
      this.handleWisdomInput();
      return;
    }

    this.abortTextSearch();
    this.abortWisdomSearch();
    this.updateArmedChip(false);
    this.filterFiles();
  }

  filterFiles() {
    const query = this.input?.value.trim().toLowerCase() ?? '';
    const allFiles = this.getFileList?.() ?? [];
    if (allFiles !== this.lastFileListRef) {
      this.lastFileListRef = allFiles;
      this.fileCorpus = allFiles.map((filePath) => createCorpusEntry(filePath));
    }

    if (!query) {
      this.filteredFiles = this.fileCorpus
        .slice(0, MAX_VISIBLE_RESULTS)
        .map((entry) => entry.filePath);
      this.fileMatchTotal = this.fileCorpus.length;
    } else {
      const ranked = [];
      let matchTotal = 0;
      this.fileCorpus.forEach((entry) => {
        const score = this.fuzzyScore(entry, query);
        if (score <= 0) {
          return;
        }

        matchTotal += 1;
        const rankedEntry = { filePath: entry.filePath, score };
        let inserted = false;
        for (let index = 0; index < ranked.length; index += 1) {
          const current = ranked[index];
          if (score > current.score || (score === current.score && entry.lowerPath < String(current.filePath).toLowerCase())) {
            ranked.splice(index, 0, rankedEntry);
            inserted = true;
            break;
          }
        }

        if (!inserted && ranked.length < MAX_VISIBLE_RESULTS) {
          ranked.push(rankedEntry);
        }

        if (ranked.length > MAX_VISIBLE_RESULTS) {
          ranked.length = MAX_VISIBLE_RESULTS;
        }
      });

      this.filteredFiles = ranked.map((entry) => entry.filePath);
      this.fileMatchTotal = matchTotal;
    }

    this.selectedIndex = 0;
    this.renderResults(query);
  }

  fuzzyScore(entry, query) {
    const name = entry.lowerDisplayName;
    const nameOnly = entry.lowerFileName;

    if (nameOnly.includes(query)) return 100 + (1 / nameOnly.length);
    if (name.includes(query)) return 50 + (1 / name.length);

    let queryIndex = 0;
    let score = 0;
    let consecutiveBonus = 0;

    for (let i = 0; i < name.length && queryIndex < query.length; i++) {
      if (name[i] === query[queryIndex]) {
        queryIndex++;
        consecutiveBonus += 1;
        score += consecutiveBonus;

        if (i === 0 || name[i - 1] === '/' || name[i - 1] === '-' || name[i - 1] === '_' || name[i - 1] === ' ') {
          score += 5;
        }
      } else {
        consecutiveBonus = 0;
      }
    }

    return queryIndex === query.length ? score : 0;
  }

  renderResults(query) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    const fallbackNotice = this.contentFallbackActive
      ? 'Content search unavailable — searching names instead'
      : '';

    if (this.filteredFiles.length === 0) {
      if (this.hint) {
        this.hint.textContent = fallbackNotice || (query ? 'No files found' : 'No files in vault');
        this.hint.classList.remove('hidden');
      }
      return;
    }

    if (this.hint) {
      let hintText = '';
      const truncated = this.fileMatchTotal > this.filteredFiles.length;
      if (fallbackNotice) {
        hintText = truncated ? `${fallbackNotice} · ${this.fileMatchTotal} matches` : fallbackNotice;
      } else if (query && truncated) {
        hintText = `${this.fileMatchTotal} matches · showing top ${this.filteredFiles.length} · keep typing to narrow`;
      }

      if (hintText) {
        this.hint.textContent = hintText;
        this.hint.classList.remove('hidden');
      } else {
        this.hint.classList.add('hidden');
      }
    }

    const fragment = document.createDocumentFragment();

    this.filteredFiles.forEach((filePath, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'qs-result-item';
      if (index === this.selectedIndex) {
        item.classList.add('selected');
      }
      item.dataset.index = String(index);

      const fileName = getFileName(filePath);
      const dirPath = getDirPath(filePath);

      item.innerHTML = `
        <svg class="qs-result-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="qs-result-name">${this.highlightMatch(fileName, query)}</span>
        ${dirPath ? `<span class="qs-result-path">${escapeHtml(dirPath)}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        this.selectedIndex = index;
        this.confirmSelection();
      });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      fragment.appendChild(item);
    });

    this.resultsList.appendChild(fragment);
  }

  highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);

    if (idx >= 0) {
      const before = text.slice(0, idx);
      const match = text.slice(idx, idx + query.length);
      const after = text.slice(idx + query.length);
      return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
    }

    let result = '';
    let queryIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (queryIdx < query.length && text[i].toLowerCase() === query[queryIdx]) {
        result += `<mark>${escapeHtml(text[i])}</mark>`;
        queryIdx++;
      } else {
        result += escapeHtml(text[i]);
      }
    }
    return result;
  }

  abortTextSearch({ invalidate = true } = {}) {
    this.textSearchRunner.abort({ invalidate });
  }

  // UX6 — switch to Files (name) search with the current query when content search can't run,
  // so the user still gets an answer instead of a bare "requires ripgrep" dead-end. Updates the
  // chrome inline (no setMode recursion) and flags the fallback so renderResults explains it.
  fallBackToFilesSearch() {
    this.abortTextSearch();
    this.contentFallbackActive = true;
    this.mode = 'files';
    this.selectedIndex = 0;
    this.modeTabs.forEach((tab) => {
      const isActive = tab.dataset.qsMode === 'files';
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (this.input) {
      this.input.placeholder = 'Search files...';
    }
    this.filterFiles();
  }

  scheduleTextSearch() {
    const query = this.input?.value.trim() ?? '';
    const searchConfig = this.getSearchConfig?.() ?? {};

    // UX6 — content search backend unavailable: never dead-end on a bare error. Fall the query
    // over to name search and tell the user, so they still get an answer.
    if (query && !searchConfig.available) {
      this.fallBackToFilesSearch();
      return;
    }

    this.textResults = null;
    this.textResultItems = [];
    this.textSearchRunner.schedule({
      isActive: () => this.isOpen && this.mode === 'text',
      onResults: (result, searchedQuery) => {
        this.textResults = result;
        this.textResultItems = flattenTextResults(result);
        this.selectedTextIndex = 0;
        this.renderTextResults(searchedQuery);
      },
      onState: (message) => this.renderTextState(message),
      query,
      searchConfig,
      searchText: this.searchText,
    });
  }

  renderTextState(message) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';
    if (this.hint) {
      this.hint.textContent = message;
      this.hint.classList.remove('hidden');
    }
  }

  renderTextResults(query = '') {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    if (!this.textResults?.files?.length || this.textResultItems.length === 0) {
      this.renderTextState(query ? 'No text matches found' : 'Type to search file text');
      return;
    }

    if (this.hint) {
      this.hint.classList.toggle('hidden', !this.textResults.truncated);
      this.hint.textContent = this.textResults.truncated
        ? 'Showing the first matches. Refine the query to narrow results.'
        : '';
    }

    const fragment = document.createDocumentFragment();
    let flatIndex = 0;

    this.textResults.files.forEach((fileGroup) => {
      const group = document.createElement('section');
      group.className = 'qs-text-group';

      const header = document.createElement('div');
      header.className = 'qs-text-group-header';
      header.innerHTML = `
        <span class="qs-text-file-name">${escapeHtml(getFileName(fileGroup.file))}</span>
        <span class="qs-text-file-meta">${escapeHtml(getDirPath(fileGroup.file))}</span>
        <span class="qs-text-count">${escapeHtml(formatMatchCount(fileGroup.matchCount))}</span>
      `;
      group.appendChild(header);

      (fileGroup.snippets ?? []).forEach((snippet) => {
        const itemIndex = flatIndex;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qs-text-item';
        if (itemIndex === this.selectedTextIndex) {
          item.classList.add('selected');
        }
        item.dataset.textIndex = String(itemIndex);
        item.innerHTML = `
          <span class="qs-text-line">L${escapeHtml(String(snippet.line ?? 1))}</span>
          <span class="qs-text-snippet">${this.highlightSnippet(snippet)}</span>
        `;
        item.addEventListener('click', () => {
          this.selectedTextIndex = itemIndex;
          this.confirmSelection();
        });
        item.addEventListener('mouseenter', () => {
          this.selectedTextIndex = itemIndex;
          this.updateSelection();
        });
        group.appendChild(item);
        flatIndex += 1;
      });

      fragment.appendChild(group);
    });

    this.resultsList.appendChild(fragment);
  }

  highlightSnippet(snippet = {}) {
    const text = String(snippet.text ?? '');
    const start = Math.min(Math.max(Number(snippet.matchStart) || 0, 0), text.length);
    const end = Math.min(Math.max(Number(snippet.matchEnd) || start, start), text.length);
    return `${escapeHtml(text.slice(0, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>${escapeHtml(text.slice(end))}`;
  }

  // ===== Wisdom mode (submit-driven, progressive) =====

  wisdomMinQueryLength() {
    const config = this.getWisdomSearchConfig?.() ?? {};
    return Math.max(Number(config.minQueryLength) || 2, 1);
  }

  abortWisdomSearch({ invalidate = true } = {}) {
    this.wisdomSearchRunner?.abort({ invalidate });
    this.wisdomLoading = false;
    this.wisdomProvisional = false;
  }

  handleWisdomInput() {
    const query = this.input?.value.trim() ?? '';
    const minLen = this.wisdomMinQueryLength();

    // Query unchanged since the last run → keep showing that run's results.
    if (query.length > 0 && query === this.wisdomLastRunQuery && (this.wisdomResults || this.wisdomLoading)) {
      this.updateArmedChip(false);
      this.renderWisdomResults(query);
      return;
    }

    // Query changed → re-arm Enter and drop the stale run.
    this.wisdomSearchRunner.abort({ invalidate: true });
    this.wisdomResults = null;
    this.wisdomResultItems = [];
    this.wisdomLoading = false;
    this.wisdomProvisional = false;
    this.wisdomStopped = false;
    this.wisdomLastRunQuery = null;
    this.selectedWisdomIndex = 0;

    const armed = query.length >= minLen;
    this.updateArmedChip(armed);

    if (!query) {
      this.renderWisdomState(WISDOM_EMPTY_HINT, { subhint: WISDOM_EMPTY_SUBHINT });
    } else if (query.length < minLen) {
      this.renderWisdomState(`Type at least ${minLen} characters, then press Enter.`);
    } else {
      this.renderWisdomState(WISDOM_ARMED_HINT);
    }
  }

  runWisdomSearch() {
    const query = this.input?.value.trim() ?? '';
    const minLen = this.wisdomMinQueryLength();
    if (query.length < minLen) {
      this.renderWisdomState(`Type at least ${minLen} characters, then press Enter.`);
      return;
    }

    this.wisdomLastRunQuery = query;
    this.wisdomResults = null;
    this.wisdomResultItems = [];
    this.selectedWisdomIndex = 0;
    this.wisdomProvisional = true;
    this.wisdomStopped = false;
    this.wisdomLoading = true;
    this.wisdomProgressCopy = 'Ranking by meaning… 0s · usually ~15s';
    this.updateArmedChip(false);

    this.wisdomSearchRunner.run({
      isActive: () => this.isOpen && this.mode === WISDOM_MODE,
      onEmpty: () => {
        this.wisdomLoading = false;
        this.wisdomProvisional = false;
        this.renderWisdomEmpty(query);
      },
      onFinal: (result) => {
        this.wisdomLoading = false;
        this.wisdomProvisional = false;
        this.setWisdomResults(result, { provisional: false });
      },
      onPreview: (result) => {
        this.setWisdomResults(result, { provisional: true });
      },
      onProgress: (copy) => {
        this.wisdomProgressCopy = copy;
        this.updateWisdomProgressCopy(copy);
      },
      onProgressEnd: ({ keptPreview = false } = {}) => {
        this.wisdomLoading = false;
        // Authoritative call failed but the lex preview is up → lock it in as the final
        // result ("keyword matches only"), dropping the progress affordance.
        if (keptPreview) {
          this.wisdomProvisional = false;
          this.wisdomStopped = true;
          this.renderWisdomResults();
        }
      },
      onUnavailable: (message) => {
        this.wisdomLoading = false;
        this.wisdomProvisional = false;
        this.renderWisdomUnavailable(message);
      },
      query,
      wisdomSearch: this.wisdomSearch,
    });

    // Immediate loading paint (progress affordance over an empty panel, per FDE §2c).
    this.renderWisdomResults(query);
  }

  stopWisdomSearch() {
    this.wisdomSearchRunner.stop();
    this.wisdomLoading = false;
    this.wisdomProvisional = false;
    this.wisdomStopped = true;
    this.renderWisdomResults(this.wisdomLastRunQuery ?? '');
  }

  setWisdomResults(result, { provisional }) {
    this.wisdomResults = result;
    this.wisdomResultItems = flattenTextResults({
      files: (result?.files ?? []).filter((fileGroup) => !fileGroup.unresolvable),
    });
    this.wisdomProvisional = provisional;
    if (this.selectedWisdomIndex >= this.wisdomResultItems.length) {
      this.selectedWisdomIndex = Math.max(this.wisdomResultItems.length - 1, 0);
    }
    this.renderWisdomResults(this.wisdomLastRunQuery ?? '');
  }

  renderWisdomState(message, { subhint = '' } = {}) {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';
    if (this.hint) {
      this.hint.innerHTML = subhint
        ? `${escapeHtml(message)}<span class="qs-hint-sub">${escapeHtml(subhint)}</span>`
        : escapeHtml(message);
      this.hint.classList.remove('hidden');
    }
  }

  renderWisdomEmpty(query) {
    this.renderWisdomState(`No wisdom matches for "${query}".`, {
      subhint: 'Try fewer or more general words. Files edited in the last ~2 min may not be indexed yet.',
    });
  }

  renderWisdomUnavailable(message) {
    this.renderWisdomState(message || 'Wisdom search is unavailable right now.', {
      subhint: 'The search engine didn\'t respond. Try again shortly — or use Text mode for a keyword search.',
    });
  }

  updateWisdomProgressCopy(copy) {
    const label = this.resultsList?.querySelector('.qs-progress-label');
    if (label) {
      label.textContent = copy;
    }
  }

  buildWisdomProgressRow() {
    const row = document.createElement('div');
    row.className = 'qs-progress';
    row.setAttribute('role', 'status');
    row.setAttribute('aria-live', 'polite');
    row.innerHTML = `
      <span class="qs-progress-spin" aria-hidden="true"></span>
      <span class="qs-progress-label">${escapeHtml(this.wisdomProgressCopy || 'Ranking by meaning…')}</span>
    `;
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'qs-progress-stop';
    stop.textContent = 'Stop';
    stop.addEventListener('click', () => this.stopWisdomSearch());
    row.appendChild(stop);

    const bar = document.createElement('div');
    bar.className = 'qs-progressbar';
    bar.setAttribute('aria-hidden', 'true');

    const wrapper = document.createDocumentFragment();
    wrapper.appendChild(row);
    wrapper.appendChild(bar);
    return wrapper;
  }

  renderWisdomResults() {
    if (!this.resultsList) return;
    this.resultsList.innerHTML = '';

    const files = this.wisdomResults?.files ?? [];
    const hasResults = files.length > 0;

    // Loading with no preview yet → progress affordance only.
    if (!hasResults) {
      if (this.wisdomLoading) {
        this.resultsList.appendChild(this.buildWisdomProgressRow());
        if (this.hint) {
          this.hint.classList.add('hidden');
        }
      }
      return;
    }

    if (this.hint) {
      this.hint.classList.toggle('hidden', !this.wisdomResults?.truncated);
      this.hint.textContent = this.wisdomResults?.truncated
        ? 'Showing the first matches. Refine the query to narrow results.'
        : '';
    }

    const fragment = document.createDocumentFragment();

    if (this.wisdomLoading) {
      fragment.appendChild(this.buildWisdomProgressRow());
    }

    if (this.wisdomProvisional || this.wisdomStopped) {
      const pill = document.createElement('div');
      pill.className = 'prov-tag';
      pill.textContent = this.wisdomStopped ? 'Keyword matches only' : 'Keyword matches — refining…';
      fragment.appendChild(pill);
    }

    const list = document.createElement('div');
    list.className = this.wisdomProvisional ? 'qs-wisdom-list provisional' : 'qs-wisdom-list';

    let navIndex = 0;
    files.forEach((fileGroup) => {
      const group = document.createElement('section');
      group.className = fileGroup.unresolvable ? 'qs-text-group unresolvable' : 'qs-text-group';

      const header = document.createElement('div');
      header.className = 'qs-text-group-header';
      const meta = fileGroup.unresolvable
        ? '<span class="notfound-tag">not in vault</span>'
        : `<span class="qs-text-file-meta">${escapeHtml(getDirPath(fileGroup.file))}</span>`;
      header.innerHTML = `
        <span class="qs-text-file-name">${escapeHtml(getFileName(fileGroup.file))}</span>
        ${meta}
        <span class="qs-text-count">${escapeHtml(formatMatchCount(fileGroup.matchCount))}</span>
      `;
      group.appendChild(header);

      (fileGroup.snippets ?? []).forEach((snippet) => {
        const item = document.createElement('button');
        item.type = 'button';

        if (fileGroup.unresolvable) {
          item.className = 'qs-text-item disabled';
          item.disabled = true;
          item.setAttribute('aria-disabled', 'true');
          item.innerHTML = `
            <span class="qs-text-line">—</span>
            <span class="qs-text-snippet">${this.highlightSnippet(snippet)}</span>
          `;
          group.appendChild(item);
          return;
        }

        const itemIndex = navIndex;
        item.className = 'qs-text-item';
        if (itemIndex === this.selectedWisdomIndex) {
          item.classList.add('selected');
        }
        item.dataset.wisdomIndex = String(itemIndex);
        const lineLabel = snippet.line == null ? '—' : `L${escapeHtml(String(snippet.line))}`;
        const metaSlot = snippet.line == null
          ? '<span class="qs-text-line semantic">semantic</span>'
          : `<span class="qs-text-line">${lineLabel}</span>`;
        item.innerHTML = `
          ${metaSlot}
          <span class="qs-text-snippet">${this.highlightSnippet(snippet)}</span>
        `;
        item.addEventListener('click', () => {
          this.selectedWisdomIndex = itemIndex;
          this.confirmSelection();
        });
        item.addEventListener('mouseenter', () => {
          this.selectedWisdomIndex = itemIndex;
          this.updateSelection();
        });
        group.appendChild(item);
        navIndex += 1;
      });

      list.appendChild(group);
    });

    fragment.appendChild(list);
    this.resultsList.appendChild(fragment);
  }

  moveSelection(delta) {
    if (this.mode === WISDOM_MODE) {
      if (this.wisdomResultItems.length === 0) return;
      this.selectedWisdomIndex = (this.selectedWisdomIndex + delta + this.wisdomResultItems.length) % this.wisdomResultItems.length;
      this.updateSelection();
      return;
    }

    if (this.mode === 'text') {
      if (this.textResultItems.length === 0) return;
      this.selectedTextIndex = (this.selectedTextIndex + delta + this.textResultItems.length) % this.textResultItems.length;
      this.updateSelection();
      return;
    }

    if (this.filteredFiles.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.filteredFiles.length) % this.filteredFiles.length;
    this.updateSelection();
  }

  updateSelection() {
    if (!this.resultsList) return;

    if (this.mode === WISDOM_MODE) {
      const items = this.resultsList.querySelectorAll('.qs-text-item[data-wisdom-index]');
      items.forEach((item, i) => {
        item.classList.toggle('selected', i === this.selectedWisdomIndex);
      });
      items[this.selectedWisdomIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (this.mode === 'text') {
      const items = this.resultsList.querySelectorAll('.qs-text-item');
      items.forEach((item, i) => {
        item.classList.toggle('selected', i === this.selectedTextIndex);
      });
      items[this.selectedTextIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    const items = this.resultsList.querySelectorAll('.qs-result-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });

    items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  confirmSelection() {
    if (this.mode === WISDOM_MODE) {
      const query = this.input?.value.trim() ?? '';
      // Enter runs the search when the query changed since the last run (armed); once
      // results are shown for the current query, Enter opens the selected hit.
      if (query !== this.wisdomLastRunQuery) {
        if (query.length >= this.wisdomMinQueryLength()) {
          this.runWisdomSearch();
        }
        return;
      }
      const match = this.wisdomResultItems[this.selectedWisdomIndex];
      if (match) {
        this.close();
        this.onTextMatchSelect?.(match);
      }
      return;
    }

    if (this.mode === 'text') {
      const match = this.textResultItems[this.selectedTextIndex];
      if (match) {
        this.close();
        this.onTextMatchSelect?.(match);
      }
      return;
    }

    const filePath = this.filteredFiles[this.selectedIndex];
    if (filePath) {
      this.close();
      this.onFileSelect?.(filePath);
    }
  }
}
