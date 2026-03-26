import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';
import { escapeHtml } from '../domain/vault-utils.js';

function createShellKey() {
  return `base-${Math.random().toString(36).slice(2, 10)}`;
}

function looksLikeHexColor(value = '') {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(String(value ?? '').trim());
}

function looksLikeExternalImageUrl(value = '') {
  return /^https?:\/\/.+\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/iu.test(String(value ?? '').trim());
}

function getCardImageCell(view, columns, row) {
  const preferred = view.image
    || columns.find((column) => ['cover', 'image'].includes(String(column.id ?? '').toLowerCase()))?.id
    || null;
  return preferred ? row.cells[preferred] ?? null : null;
}

function formatCellText(cell) {
  return String(cell?.text ?? '');
}

function createAttachmentUrl(path = '') {
  return resolveApiUrl(`/attachment?path=${encodeURIComponent(path)}`);
}

function getImageUrlFromCell(cell = {}) {
  if (cell?.type === 'image' && cell.path) {
    return createAttachmentUrl(cell.path);
  }

  if (cell?.type === 'link') {
    if (cell.external && looksLikeExternalImageUrl(cell.url)) {
      return cell.url;
    }
    if (cell.path && isImageAttachmentFilePath(cell.path)) {
      return createAttachmentUrl(cell.path);
    }
  }

  const text = formatCellText(cell);
  if (looksLikeExternalImageUrl(text)) {
    return text;
  }
  if (isImageAttachmentFilePath(text)) {
    return createAttachmentUrl(text);
  }

  return '';
}

function renderValue(cell = {}) {
  const type = cell?.type || 'string';
  if (type === 'empty') {
    return '<span class="bases-value bases-value-empty">—</span>';
  }
  if (type === 'boolean') {
    return `<span class="bases-value bases-value-boolean">${cell.value ? 'True' : 'False'}</span>`;
  }
  if (type === 'image' && cell.path) {
    return `<img class="bases-inline-image" src="${escapeHtml(createAttachmentUrl(cell.path))}" alt="${escapeHtml(formatCellText(cell))}">`;
  }
  if (type === 'list') {
    return `<span class="bases-value-list">${(cell.items ?? []).map((item) => `<span class="bases-value-pill">${renderValue(item)}</span>`).join('')}</span>`;
  }
  if (type === 'link') {
    if (cell.external && cell.url) {
      return `<a class="bases-link" href="${escapeHtml(cell.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatCellText(cell))}</a>`;
    }
    if (cell.path) {
      return `<button type="button" class="bases-link bases-link-button" data-base-open-file="${escapeHtml(cell.path)}">${escapeHtml(formatCellText(cell))}</button>`;
    }
  }
  if (type === 'file' && cell.path) {
    return `<button type="button" class="bases-link bases-link-button" data-base-open-file="${escapeHtml(cell.path)}">${escapeHtml(formatCellText(cell))}</button>`;
  }

  const text = formatCellText(cell);
  return `<span class="bases-value">${escapeHtml(text)}</span>`;
}

function renderRowValue(column, row) {
  const cell = row?.cells?.[column.id] ?? null;
  if (
    row?.path
    && cell
    && cell.type !== 'empty'
    && (column.id === 'file.name' || column.id === 'file.basename')
  ) {
    return `<button type="button" class="bases-link bases-link-button" data-base-open-file="${escapeHtml(row.path)}">${escapeHtml(formatCellText(cell))}</button>`;
  }

  return renderValue(cell);
}

function renderSummaryBar(summaries = []) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '';
  }
  return `<div class="bases-summaries">${summaries.map((summary) => (
    `<div class="bases-summary"><span class="bases-summary-label">${escapeHtml(summary.label)}</span><span class="bases-summary-value">${escapeHtml(formatCellText(summary.value))}</span></div>`
  )).join('')}</div>`;
}

function renderTable(columns, groups) {
  return groups.map((group) => (
    `<section class="bases-group"><header class="bases-group-header"><h3>${escapeHtml(group.label)}</h3>${renderSummaryBar(group.summaries)}</header><div class="bases-table-shell"><table class="bases-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${(group.rows ?? []).map((row) => `<tr>${columns.map((column) => `<td>${renderRowValue(column, row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
  )).join('');
}

function renderList(columns, groups) {
  return groups.map((group) => (
    `<section class="bases-group"><header class="bases-group-header"><h3>${escapeHtml(group.label)}</h3>${renderSummaryBar(group.summaries)}</header><ul class="bases-list">${(group.rows ?? []).map((row) => (
      `<li class="bases-list-item">${columns.map((column) => {
        const cell = row.cells[column.id];
        if (!cell || cell.type === 'empty') {
          return '';
        }
        return `<span class="bases-list-field"><strong>${escapeHtml(column.label)}:</strong> ${renderRowValue(column, row)}</span>`;
      }).join('')}</li>`
    )).join('')}</ul></section>`
  )).join('');
}

function renderCards(columns, groups, view) {
  return groups.map((group) => (
    `<section class="bases-group"><header class="bases-group-header"><h3>${escapeHtml(group.label)}</h3>${renderSummaryBar(group.summaries)}</header><div class="bases-cards">${(group.rows ?? []).map((row) => {
      const imageCell = getCardImageCell(view, columns, row);
      const imageText = formatCellText(imageCell);
      let mediaHtml = '';
      if (looksLikeHexColor(imageText)) {
        mediaHtml = `<div class="bases-card-media bases-card-media-color" style="--bases-card-swatch:${escapeHtml(imageText)}"></div>`;
      } else {
        const url = getImageUrlFromCell(imageCell);
        if (url) {
          mediaHtml = `<img class="bases-card-media" src="${escapeHtml(url)}" alt="${escapeHtml(imageText)}">`;
        }
      }

      return `<article class="bases-card">${mediaHtml}<div class="bases-card-body">${columns.map((column) => {
        const cell = row.cells[column.id];
        if (!cell || cell.type === 'empty') {
          return '';
        }
        return `<div class="bases-card-field"><div class="bases-card-label">${escapeHtml(column.label)}</div><div class="bases-card-value">${renderRowValue(column, row)}</div></div>`;
      }).join('')}</div></article>`;
    }).join('')}</div></section>`
  )).join('');
}

function renderViewBody(result) {
  if (!result.view.supported) {
    return `<div class="bases-unsupported">CollabMD parsed this view but does not render the <code>${escapeHtml(result.view.type)}</code> layout yet.</div>`;
  }

  switch (result.view.type) {
    case 'cards':
      return renderCards(result.columns, result.groups, result.view);
    case 'list':
      return renderList(result.columns, result.groups);
    case 'table':
    default:
      return renderTable(result.columns, result.groups);
  }
}

function renderViewTabs(result) {
  return (result.views ?? []).map((view) => (
    `<button type="button" class="bases-view-tab${view.id === result.view.id ? ' is-active' : ''}" data-base-view="${escapeHtml(view.id)}">${escapeHtml(view.name)}</button>`
  )).join('');
}

function renderShellHtml(result, state) {
  return `
    <section class="bases-shell" data-base-shell-key="${escapeHtml(state.key)}">
      <header class="bases-toolbar">
        <div class="bases-toolbar-main">
          <div class="bases-tabs" data-base-tabs>
            ${renderViewTabs(result)}
          </div>
          <div class="bases-meta" data-base-meta>${escapeHtml(String(result.totalRows ?? 0))} results</div>
        </div>
        <div class="bases-toolbar-actions">
          <input class="bases-search-input" type="search" value="${escapeHtml(state.search)}" placeholder="Search this base">
          <button type="button" class="bases-export-btn">Export CSV</button>
        </div>
      </header>
      <div data-base-summary-slot>${renderSummaryBar(result.summaries)}</div>
      <div class="bases-content" data-base-content>${renderViewBody(result)}</div>
    </section>
  `;
}

function findShellElement(entry) {
  if (!entry?.placeholder?.querySelector) {
    return null;
  }

  return entry.placeholder.querySelector(`[data-base-shell-key="${entry.key}"]`)
    ?? entry.placeholder.querySelector('.bases-shell');
}

function updateShellContent(entry, result) {
  const shell = findShellElement(entry);
  if (!shell?.querySelector) {
    entry.placeholder.innerHTML = renderShellHtml(result, entry);
    return;
  }

  const tabs = shell.querySelector('[data-base-tabs]');
  if (tabs) {
    tabs.innerHTML = renderViewTabs(result);
  }

  const meta = shell.querySelector('[data-base-meta]');
  if (meta) {
    meta.textContent = `${String(result.totalRows ?? 0)} results`;
  }

  const summarySlot = shell.querySelector('[data-base-summary-slot]');
  if (summarySlot) {
    summarySlot.innerHTML = renderSummaryBar(result.summaries);
  }

  const content = shell.querySelector('[data-base-content]');
  if (content) {
    content.innerHTML = renderViewBody(result);
  }

  const input = shell.querySelector('.bases-search-input');
  if (input && input.value !== entry.search) {
    input.value = entry.search;
  }
}

function downloadBlob(blob, fileName = 'base.csv') {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseDownloadFileName(contentDisposition = '') {
  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/iu);
  if (utfMatch) {
    return decodeURIComponent(utfMatch[1]);
  }
  const asciiMatch = contentDisposition.match(/filename="([^"]+)"/iu);
  return asciiMatch?.[1] || 'base.csv';
}

export class BasesPreviewController {
  constructor({
    getActiveFilePath = () => '',
    onOpenFile,
    previewElement,
    toastController,
    vaultApiClient,
  }) {
    this.getActiveFilePath = getActiveFilePath;
    this.onOpenFile = onOpenFile;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.vaultApiClient = vaultApiClient;
    this.entries = new Map();
    this.searchTimers = new Map();

    this.handleClick = (event) => {
      const openButton = event.target.closest('[data-base-open-file]');
      if (openButton) {
        event.preventDefault();
        this.onOpenFile?.(openButton.dataset.baseOpenFile || '');
        return;
      }

      const tab = event.target.closest('.bases-view-tab');
      if (tab) {
        const shell = tab.closest('[data-base-shell-key]');
        const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
        if (!entry) {
          return;
        }

        entry.payload.view = tab.dataset.baseView || '';
        void this.renderEntry(entry);
        return;
      }

      const exportButton = event.target.closest('.bases-export-btn');
      if (exportButton) {
        const shell = exportButton.closest('[data-base-shell-key]');
        const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
        if (!entry) {
          return;
        }

        void this.exportEntry(entry);
      }
    };

    this.handleInput = (event) => {
      const input = event.target.closest('.bases-search-input');
      if (!input) {
        return;
      }

      const shell = input.closest('[data-base-shell-key]');
      const entry = shell ? this.entries.get(shell.dataset.baseShellKey || '') : null;
      if (!entry) {
        return;
      }

      entry.search = input.value || '';
      clearTimeout(this.searchTimers.get(entry.key));
      this.searchTimers.set(entry.key, setTimeout(() => {
        entry.payload.search = entry.search;
        void this.renderEntry(entry);
      }, 180));
    };

    this.previewElement?.addEventListener('click', this.handleClick);
    this.previewElement?.addEventListener('input', this.handleInput);
  }

  destroy() {
    this.previewElement?.removeEventListener('click', this.handleClick);
    this.previewElement?.removeEventListener('input', this.handleInput);
    this.searchTimers.forEach((timer) => clearTimeout(timer));
    this.searchTimers.clear();
    this.entries.clear();
  }

  reconcileEmbeds(previewElement = this.previewElement) {
    if (!previewElement) {
      return;
    }

    Array.from(previewElement.querySelectorAll('.bases-embed-placeholder[data-base-key]')).forEach((placeholder) => {
      const key = placeholder.dataset.baseKey || createShellKey();
      const existing = this.entries.get(key);
      const payload = {
        path: placeholder.dataset.basePath || '',
        search: '',
        source: placeholder.dataset.baseSource || null,
        sourcePath: placeholder.dataset.baseSourcePath || '',
        view: placeholder.dataset.baseView || '',
      };
    const entry = existing ?? {
      key,
      payload,
      placeholder,
      requestVersion: 0,
      result: null,
      search: '',
    };
      entry.payload = payload;
      entry.placeholder = placeholder;
      this.entries.set(key, entry);
      void this.renderEntry(entry);
    });
  }

  async renderStandalone({ filePath, renderHost, source = null }) {
    const key = `standalone:${filePath}`;
    const entry = this.entries.get(key) ?? {
      key,
      payload: {
        path: filePath,
        search: '',
        source,
        sourcePath: filePath,
        view: '',
      },
      placeholder: renderHost,
      requestVersion: 0,
      result: null,
      search: '',
    };
    entry.placeholder = renderHost;
    entry.payload.path = filePath;
    entry.payload.source = typeof source === 'string' ? source : null;
    entry.payload.sourcePath = filePath;
    this.entries.set(key, entry);
    await this.renderEntry(entry);
  }

  async renderEntry(entry) {
    if (!entry?.placeholder?.isConnected) {
      return;
    }

    const requestVersion = (entry.requestVersion ?? 0) + 1;
    entry.requestVersion = requestVersion;
    const hasShell = Boolean(findShellElement(entry));
    if (!hasShell) {
      entry.placeholder.innerHTML = '<div class="preview-shell">Loading base…</div>';
    }
    try {
      const response = await this.vaultApiClient.queryBase({
        activeFilePath: this.getActiveFilePath?.() ?? '',
        ...entry.payload,
      });
      if (requestVersion !== entry.requestVersion || !entry?.placeholder?.isConnected) {
        return;
      }
      entry.result = response.result;
      updateShellContent(entry, entry.result);
    } catch (error) {
      if (requestVersion !== entry.requestVersion || !entry?.placeholder?.isConnected) {
        return;
      }
      if (hasShell) {
        const shell = findShellElement(entry);
        const content = shell?.querySelector?.('[data-base-content]') ?? null;
        if (content) {
          content.innerHTML = `<div class="preview-shell">Failed to load base: ${escapeHtml(error.message || 'Unknown error')}</div>`;
          return;
        }
      }
      entry.placeholder.innerHTML = `<div class="preview-shell">Failed to load base: ${escapeHtml(error.message || 'Unknown error')}</div>`;
    }
  }

  async exportEntry(entry) {
    try {
      const response = await this.vaultApiClient.exportBaseCsv({
        activeFilePath: this.getActiveFilePath?.() ?? '',
        ...entry.payload,
      });
      downloadBlob(response.blob, parseDownloadFileName(response.contentDisposition));
    } catch (error) {
      this.toastController?.show?.(error.message || 'Failed to export base CSV');
    }
  }
}
