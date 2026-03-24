import { exportToSvg as exportExcalidrawToSvg } from '@excalidraw/excalidraw';

import { sanitizeSvgMarkup } from '../application/preview-diagram-utils.js';
import { compilePreviewDocument } from '../application/preview-render-compiler.js';
import { stripVaultFileExtension } from '../../domain/file-kind.js';
import { parseSceneJson, sceneToInitialData } from '../domain/excalidraw-scene.js';
import { resolveApiUrl, resolveAppUrl } from '../infrastructure/runtime-config.js';

const EXPORT_PAGE_SOURCE = 'collabmd-export-page';
const EXPORT_HOST_SOURCE = 'collabmd-export-host';
const LIGHT_EXPORT_MERMAID_THEME = Object.freeze({
  flowchart: {
    defaultRenderer: 'dagre-wrapper',
    useMaxWidth: true,
  },
  class: {
    defaultRenderer: 'dagre-wrapper',
    useMaxWidth: true,
  },
  startOnLoad: false,
  theme: 'default',
});
const EXPORT_ASSET_FETCH_TIMEOUT_MS = 10_000;
const EXPORT_ASSET_MAX_BYTES = 10 * 1024 * 1024;

let mermaidLoaderPromise = null;
let assetCounter = 0;

function createAssetId(prefix = 'asset') {
  assetCounter += 1;
  return `${prefix}-${assetCounter.toString(36)}`;
}

function createDocumentTitle(filePath, title = '') {
  const normalizedTitle = String(title ?? '').trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const leaf = String(filePath ?? '').split('/').filter(Boolean).pop() || 'document';
  return stripVaultFileExtension(leaf) || 'document';
}

function encodeSvgDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read blob')));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)), { once: true });
    image.src = src;
  });
}

function resolveSvgDimensions(svgElement) {
  const widthAttr = Number.parseFloat(svgElement.getAttribute('width') || '');
  const heightAttr = Number.parseFloat(svgElement.getAttribute('height') || '');
  const viewBox = svgElement.getAttribute('viewBox') || '';
  const viewBoxParts = viewBox.split(/\s+/).map((value) => Number.parseFloat(value));

  const width = Number.isFinite(widthAttr) && widthAttr > 0
    ? widthAttr
    : (Number.isFinite(viewBoxParts[2]) && viewBoxParts[2] > 0 ? viewBoxParts[2] : 1200);
  const height = Number.isFinite(heightAttr) && heightAttr > 0
    ? heightAttr
    : (Number.isFinite(viewBoxParts[3]) && viewBoxParts[3] > 0 ? viewBoxParts[3] : 800);

  return {
    height,
    width,
  };
}

function trimSvgCanvas(svgMarkup, { padding = 16 } = {}) {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-10000px';
  probe.style.top = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.innerHTML = svgMarkup;
  document.body.appendChild(probe);

  try {
    const svgElement = probe.querySelector('svg');
    if (!(svgElement instanceof SVGSVGElement)) {
      return svgMarkup;
    }

    let bounds = null;
    try {
      bounds = svgElement.getBBox();
    } catch {
      return svgMarkup;
    }

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return svgMarkup;
    }

    const inset = Math.max(0, Number(padding) || 0);
    const nextViewBox = [
      Math.floor(bounds.x - inset),
      Math.floor(bounds.y - inset),
      Math.ceil(bounds.width + (inset * 2)),
      Math.ceil(bounds.height + (inset * 2)),
    ];

    const trimmedWidth = Math.ceil(bounds.width + (inset * 2));
    const trimmedHeight = Math.ceil(bounds.height + (inset * 2));

    svgElement.setAttribute('viewBox', nextViewBox.join(' '));
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgElement.setAttribute('width', String(trimmedWidth));
    svgElement.setAttribute('height', String(trimmedHeight));
    return svgElement.outerHTML;
  } finally {
    probe.remove();
  }
}

function normalizeExportSvgMarkup(svgMarkup, options = {}) {
  return trimSvgCanvas(sanitizeSvgMarkup(svgMarkup), options);
}

async function svgMarkupToPngDataUrl(svgMarkup) {
  const svgDataUrl = encodeSvgDataUrl(svgMarkup);
  const image = await loadImage(svgDataUrl);
  const svgProbe = document.createElement('div');
  svgProbe.innerHTML = svgMarkup;
  const svgElement = svgProbe.querySelector('svg');
  const { width, height } = svgElement ? resolveSvgDimensions(svgElement) : {
    height: image.naturalHeight || 800,
    width: image.naturalWidth || 1200,
  };

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function fetchTextFile(filePath) {
  const payload = await fetchJson(resolveApiUrl(`/file?path=${encodeURIComponent(filePath)}`));
  if (typeof payload?.content !== 'string') {
    throw new Error(`Failed to load ${filePath}`);
  }

  return payload.content;
}

async function fetchAsDataUrl(src, {
  maxBytes = EXPORT_ASSET_MAX_BYTES,
  timeoutMs = EXPORT_ASSET_FETCH_TIMEOUT_MS,
} = {}) {
  const assetUrl = new URL(src, window.location.href);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(assetUrl.toString(), {
      credentials: assetUrl.origin === window.location.origin ? 'same-origin' : 'omit',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Timed out while fetching asset: ${assetUrl.toString()}`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${assetUrl.toString()}`);
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Asset is too large to inline: ${assetUrl.toString()}`);
  }

  const blob = await response.blob();
  if (blob.size > maxBytes) {
    throw new Error(`Asset is too large to inline: ${assetUrl.toString()}`);
  }

  return blobToDataUrl(blob);
}

function buildWikiLinkHref(target) {
  const baseUrl = new URL(resolveAppUrl('/'), window.location.origin);
  baseUrl.hash = new URLSearchParams({ file: target }).toString();
  return baseUrl.toString();
}

function createVideoPosterElement(element) {
  const wrapper = document.createElement('figure');
  wrapper.className = 'export-video-poster';

  const card = document.createElement('div');
  card.className = 'export-video-poster-card';

  const title = document.createElement('strong');
  title.textContent = element.dataset.videoEmbedLabel || 'Embedded video';

  const meta = document.createElement('span');
  meta.className = 'export-video-poster-meta';
  meta.textContent = element.dataset.videoEmbedKind === 'youtube' ? 'YouTube video' : 'Video link';

  card.append(title, meta);

  const link = document.createElement('a');
  link.className = 'export-video-link';
  link.href = element.dataset.videoEmbedSource || element.dataset.videoEmbedUrl || '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = link.href;

  wrapper.append(card, link);
  return wrapper;
}

function createImageFallbackElement({
  alt = '',
  message = '',
  src = '',
} = {}) {
  const fallback = document.createElement('span');
  fallback.className = 'export-warning export-image-fallback';
  fallback.textContent = message || 'Image export failed';

  if (!src) {
    return fallback;
  }

  fallback.append(' ');
  const link = document.createElement('a');
  link.href = src;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  link.textContent = alt || src;
  fallback.append(link);
  return fallback;
}

function createDiagramFigureElement({
  alt,
  assetId,
  className,
  dataUrl,
  docxDataUrl,
  svgMarkup = '',
}) {
  const figure = document.createElement('figure');
  figure.className = `export-diagram ${className}`.trim();
  figure.setAttribute('data-export-asset-id', assetId);
  figure.setAttribute('data-export-label', alt);
  if (docxDataUrl) {
    figure.setAttribute('data-export-docx-src', docxDataUrl);
  }

  if (svgMarkup) {
    const surface = document.createElement('div');
    surface.className = 'export-diagram-surface';
    surface.innerHTML = svgMarkup;

    const svgElement = surface.querySelector('svg');
    if (svgElement) {
      const { width } = resolveSvgDimensions(svgElement);
      surface.style.width = '100%';
      surface.style.maxWidth = `${Math.ceil(width)}px`;
      svgElement.classList.add('export-diagram-svg');
      svgElement.setAttribute('role', 'img');
      svgElement.setAttribute('aria-label', alt);
      svgElement.removeAttribute('width');
      svgElement.removeAttribute('height');
    }

    figure.appendChild(surface);
    return figure;
  }

  const image = document.createElement('img');
  image.alt = alt;
  image.className = 'export-diagram-image';
  image.src = dataUrl;
  if (docxDataUrl) {
    image.setAttribute('data-export-docx-src', docxDataUrl);
  }
  figure.appendChild(image);
  return figure;
}

async function ensureMermaidRuntime() {
  if (mermaidLoaderPromise) {
    return mermaidLoaderPromise;
  }

  mermaidLoaderPromise = import('../mermaid-runtime.js').then((module) => {
    const runtime = module?.default;
    if (!runtime) {
      throw new Error('Mermaid runtime failed to initialize');
    }

    runtime.initialize(LIGHT_EXPORT_MERMAID_THEME);
    return runtime;
  });

  return mermaidLoaderPromise;
}

function prepareMermaidSource(source) {
  let text = String(source ?? '');

  if (!/%%\{[\s\S]*?\binit\s*:/m.test(text)) {
    if (/^\s*stateDiagram(?:-v2)?\b/m.test(text) || /^\s*classDiagram\b/m.test(text) || /^\s*gantt\b/m.test(text)) {
      text = `%%{init: ${JSON.stringify({ htmlLabels: false })}}%%\n${text}`;
    }
  }

  if (/^\s*gantt\b/m.test(text) && !/\btodayMarker\b/.test(text)) {
    const lines = text.split('\n');
    const ganttLineIndex = lines.findIndex((line) => /^\s*gantt\b/.test(line));
    if (ganttLineIndex !== -1) {
      lines.splice(ganttLineIndex + 1, 0, '    todayMarker off');
      text = lines.join('\n');
    }
  }

  return text;
}

async function renderMermaidToSvgMarkup(source) {
  const mermaid = await ensureMermaidRuntime();
  mermaid.initialize(LIGHT_EXPORT_MERMAID_THEME);
  const renderHost = document.createElement('div');
  renderHost.style.position = 'fixed';
  renderHost.style.left = '-10000px';
  renderHost.style.top = '0';
  renderHost.style.width = '1200px';
  document.body.appendChild(renderHost);

  try {
    const diagram = document.createElement('div');
    diagram.className = 'mermaid';
    diagram.id = createAssetId('mermaid-render');
    diagram.textContent = prepareMermaidSource(source);
    renderHost.appendChild(diagram);
    await mermaid.run({ nodes: [diagram] });
    const svg = diagram.querySelector('svg');
    if (!svg) {
      throw new Error('Mermaid render returned no SVG');
    }

    return normalizeExportSvgMarkup(svg.outerHTML, { padding: 24 });
  } finally {
    renderHost.remove();
  }
}

async function renderPlantUmlToSvgMarkup(source) {
  const payload = await fetchJson(resolveApiUrl('/plantuml/render'), {
    body: JSON.stringify({ source }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (typeof payload?.svg !== 'string' || !payload.svg.includes('<svg')) {
    throw new Error('PlantUML render returned no SVG');
  }

  return normalizeExportSvgMarkup(payload.svg, { padding: 16 });
}

async function renderExcalidrawToSvgMarkup(filePath) {
  const rawScene = await fetchTextFile(filePath);
  const scene = parseSceneJson(rawScene);
  const initialData = sceneToInitialData(scene, { theme: 'light' });
  const svgElement = await exportExcalidrawToSvg({
    appState: {
      ...initialData.appState,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    elements: initialData.elements.filter((element) => !element.isDeleted),
    exportPadding: 24,
    files: initialData.files || null,
  });
  return normalizeExportSvgMarkup(svgElement.outerHTML, { padding: 24 });
}

async function renderDrawioToPngDataUrl(filePath) {
  const instanceId = createAssetId('drawio-export');

  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.className = 'drawio-export-iframe';
    iframe.src = (() => {
      const url = new URL(resolveAppUrl('/drawio-editor.html'), window.location.origin);
      url.searchParams.set('file', filePath);
      url.searchParams.set('hostMode', 'export-image');
      url.searchParams.set('instanceId', instanceId);
      url.searchParams.set('mode', 'view');
      url.searchParams.set('theme', 'light');
      url.searchParams.set('previewWidth', '1200');
      return url.toString();
    })();

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while exporting draw.io diagram'));
    }, 20000);

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const payload = event.data;
      if (!payload || payload.source !== 'drawio-editor' || payload.instanceId !== instanceId) {
        return;
      }

      if (payload.type === 'export-image' && typeof payload.data === 'string' && payload.data) {
        cleanup();
        resolve(payload.data);
        return;
      }

      if (payload.type === 'error' || payload.type === 'fallback-text') {
        cleanup();
        reject(new Error(payload.message || 'Failed to export draw.io diagram'));
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', handleMessage);
      iframe.remove();
    };

    window.addEventListener('message', handleMessage);
    document.body.appendChild(iframe);
  });
}

function registerAsset(snapshot, asset) {
  snapshot.assets[asset.id] = asset;
  return asset.id;
}

async function resolveDiagramShell(snapshot, shell, { label, prefix, render }) {
  let source = shell.querySelector(`.${prefix}-source`)?.textContent ?? '';
  const target = shell.dataset[`${prefix}Target`];
  if (!source.trim() && target) {
    source = await fetchTextFile(target);
  }
  if (!source.trim()) {
    throw new Error(`${label} source is empty`);
  }

  const svgMarkup = await render(source, target);
  const svgDataUrl = encodeSvgDataUrl(svgMarkup);
  const pngDataUrl = await svgMarkupToPngDataUrl(svgMarkup);
  const assetId = registerAsset(snapshot, {
    dataUrl: svgDataUrl,
    id: createAssetId(prefix),
    kind: 'svg',
    mimeType: 'image/svg+xml',
    text: svgMarkup,
    variants: {
      docx: pngDataUrl,
    },
  });

  shell.replaceWith(createDiagramFigureElement({
    alt: label,
    assetId,
    className: `export-diagram--${prefix}`,
    dataUrl: svgDataUrl,
    docxDataUrl: pngDataUrl,
    svgMarkup,
  }));
}

async function resolveExcalidrawEmbed(snapshot, placeholder) {
  const target = String(placeholder.dataset.embedTarget ?? '').trim();
  if (!target) {
    throw new Error('Missing Excalidraw file path');
  }

  const svgMarkup = await renderExcalidrawToSvgMarkup(target);
  const svgDataUrl = encodeSvgDataUrl(svgMarkup);
  const pngDataUrl = await svgMarkupToPngDataUrl(svgMarkup);
  const assetId = registerAsset(snapshot, {
    dataUrl: svgDataUrl,
    id: createAssetId('excalidraw'),
    kind: 'svg',
    mimeType: 'image/svg+xml',
    text: svgMarkup,
    variants: {
      docx: pngDataUrl,
    },
  });

  placeholder.replaceWith(createDiagramFigureElement({
    alt: placeholder.dataset.embedLabel || 'Excalidraw diagram',
    assetId,
    className: 'export-diagram--excalidraw',
    dataUrl: svgDataUrl,
    docxDataUrl: pngDataUrl,
    svgMarkup,
  }));
}

async function resolveDrawioEmbed(snapshot, placeholder) {
  const target = String(placeholder.dataset.drawioTarget ?? '').trim();
  if (!target) {
    throw new Error('Missing draw.io file path');
  }

  const pngDataUrl = await renderDrawioToPngDataUrl(target);
  const assetId = registerAsset(snapshot, {
    dataUrl: pngDataUrl,
    id: createAssetId('drawio'),
    kind: 'png',
    mimeType: 'image/png',
  });

  placeholder.replaceWith(createDiagramFigureElement({
    alt: placeholder.dataset.drawioLabel || 'draw.io diagram',
    assetId,
    className: 'export-diagram--drawio',
    dataUrl: pngDataUrl,
    docxDataUrl: pngDataUrl,
  }));
}

async function resolveImageAssets(snapshot, container) {
  const imageNodes = Array.from(container.querySelectorAll('img'));
  for (const imageNode of imageNodes) {
    const src = imageNode.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) {
      continue;
    }

    try {
      const imageUrl = new URL(src, window.location.href);
      const dataUrl = await fetchAsDataUrl(imageUrl.toString());
      const assetId = registerAsset(snapshot, {
        dataUrl,
        id: createAssetId('image'),
        kind: 'image',
        mimeType: dataUrl.startsWith('data:image/svg+xml') ? 'image/svg+xml' : 'image/png',
      });
      imageNode.src = dataUrl;
      imageNode.setAttribute('data-export-asset-id', assetId);
      imageNode.setAttribute('data-export-docx-src', dataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to inline ${src}`;
      snapshot.warnings.push(message);
      imageNode.replaceWith(createImageFallbackElement({
        alt: imageNode.getAttribute('alt') || '',
        message: `Image export failed: ${message}. Source:`,
        src,
      }));
    }
  }
}

function rewriteWikiLinks(container) {
  Array.from(container.querySelectorAll('.wiki-link[data-wiki-target]')).forEach((link) => {
    const target = String(link.getAttribute('data-wiki-target') || '').trim();
    if (!target) {
      return;
    }

    link.setAttribute('href', buildWikiLinkHref(target));
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

function rewriteTaskCheckboxes(container) {
  Array.from(container.querySelectorAll('.task-list-item input[type="checkbox"]')).forEach((checkbox) => {
    checkbox.setAttribute('disabled', 'true');
  });
}

export async function resolveExportAssets(snapshot, {
  container,
} = {}) {
  rewriteWikiLinks(container);
  rewriteTaskCheckboxes(container);

  const videoShells = Array.from(container.querySelectorAll('.video-embed-placeholder[data-video-embed-key]'));
  videoShells.forEach((shell) => {
    shell.replaceWith(createVideoPosterElement(shell));
  });

  const mermaidShells = Array.from(container.querySelectorAll('.mermaid-shell[data-mermaid-key]'));
  for (const shell of mermaidShells) {
    try {
      await resolveDiagramShell(snapshot, shell, {
        label: shell.dataset.mermaidLabel || 'Mermaid diagram',
        prefix: 'mermaid',
        render: (source) => renderMermaidToSvgMarkup(source),
      });
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render Mermaid diagram');
      shell.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `Mermaid export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  const plantUmlShells = Array.from(container.querySelectorAll('.plantuml-shell[data-plantuml-key]'));
  for (const shell of plantUmlShells) {
    try {
      await resolveDiagramShell(snapshot, shell, {
        label: shell.dataset.plantumlLabel || 'PlantUML diagram',
        prefix: 'plantuml',
        render: (source) => renderPlantUmlToSvgMarkup(source),
      });
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render PlantUML diagram');
      shell.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `PlantUML export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  const excalidrawEmbeds = Array.from(container.querySelectorAll('.excalidraw-embed-placeholder[data-embed-key]'));
  for (const placeholder of excalidrawEmbeds) {
    try {
      await resolveExcalidrawEmbed(snapshot, placeholder);
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render Excalidraw diagram');
      placeholder.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `Excalidraw export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  const drawioEmbeds = Array.from(container.querySelectorAll('.drawio-embed-placeholder[data-drawio-key]'));
  for (const placeholder of drawioEmbeds) {
    try {
      await resolveDrawioEmbed(snapshot, placeholder);
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render draw.io diagram');
      placeholder.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `draw.io export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  await resolveImageAssets(snapshot, container);
  return snapshot;
}

export async function prepareExportSnapshot({
  fileList = [],
  filePath,
  markdownText = '',
  title = '',
} = {}) {
  const normalizedFilePath = String(filePath ?? '').trim();
  const normalizedMarkdown = String(markdownText ?? '');
  const snapshot = {
    assets: {},
    filePath: normalizedFilePath,
    generatedAt: new Date().toISOString(),
    html: '',
    sourceMarkdown: normalizedMarkdown,
    title: createDocumentTitle(normalizedFilePath, title),
    warnings: [],
  };

  const compiled = compilePreviewDocument({
    attachmentApiPath: resolveApiUrl('/attachment'),
    fileList,
    markdownText: normalizedMarkdown,
    sourceFilePath: normalizedFilePath,
  });
  const container = document.createElement('div');
  container.className = 'preview-content export-content';
  container.innerHTML = compiled.html;

  await resolveExportAssets(snapshot, { container });
  snapshot.html = container.innerHTML;
  return snapshot;
}

function buildDocxHtmlDocument(snapshot) {
  const template = document.createElement('template');
  template.innerHTML = snapshot.html;

  Array.from(template.content.querySelectorAll('figure.export-diagram[data-export-docx-src]')).forEach((figure) => {
    const docxSrc = figure.getAttribute('data-export-docx-src');
    const svgElement = figure.querySelector('svg');
    if (!docxSrc || !svgElement) {
      return;
    }

    const image = document.createElement('img');
    image.alt = figure.getAttribute('data-export-label') || 'Diagram';
    image.className = 'export-diagram-image';
    image.src = docxSrc;
    figure.replaceChildren(image);
  });

  Array.from(template.content.querySelectorAll('[data-export-docx-src]')).forEach((element) => {
    if (!(element instanceof HTMLImageElement)) {
      return;
    }

    const docxSrc = element.getAttribute('data-export-docx-src');
    if (!docxSrc) {
      return;
    }
    element.setAttribute('src', docxSrc);
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${snapshot.title}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; line-height: 1.6; }
    main { max-width: 760px; margin: 0 auto; }
    h1, h2, h3, h4, h5, h6 { color: #111827; margin: 1.3em 0 0.6em; line-height: 1.2; }
    h1 { font-size: 28px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }
    h2 { font-size: 22px; }
    h3 { font-size: 18px; }
    p, ul, ol, blockquote, pre, table, figure { margin: 0 0 16px; }
    a { color: #4338ca; text-decoration: underline; }
    pre { padding: 12px; border: 1px solid #d1d5db; background: #f8fafc; overflow: hidden; }
    code { font-family: 'JetBrains Mono', 'Courier New', monospace; background: #f3f4f6; padding: 2px 4px; }
    pre code { background: transparent; padding: 0; display: block; white-space: pre-wrap; }
    blockquote { padding-left: 14px; border-left: 3px solid #6366f1; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    img { max-width: 100%; height: auto; }
    .export-video-poster-card { padding: 14px 16px; border: 1px solid #d1d5db; background: #f8fafc; }
    .export-video-poster-meta { display: block; color: #6b7280; font-size: 12px; margin-top: 4px; }
    .export-video-link { display: block; margin-top: 8px; word-break: break-word; }
    .export-warning { color: #b45309; }
  </style>
</head>
<body>
  <main>${template.innerHTML}</main>
</body>
</html>`;
}

export async function docxAdapter(snapshot) {
  const response = await fetch(resolveApiUrl('/export/docx'), {
    body: JSON.stringify({
      filePath: snapshot.filePath,
      html: buildDocxHtmlDocument(snapshot),
      title: snapshot.title,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Failed to export DOCX');
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `${createDocumentTitle(snapshot.filePath, snapshot.title)}.docx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

export async function printPdfAdapter() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  await new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, 1500);
    const handleAfterPrint = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('afterprint', handleAfterPrint);
      resolve();
    };
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    window.print();
  });
}

export async function runExportAdapter(snapshot, format) {
  if (format === 'pdf') {
    await printPdfAdapter(snapshot);
    return;
  }

  await docxAdapter(snapshot);
}

export function postExportPageMessage(type, payload = {}) {
  if (!window.opener || window.opener.closed) {
    return;
  }

  window.opener.postMessage({
    ...payload,
    source: EXPORT_PAGE_SOURCE,
    type,
  }, window.location.origin);
}

export async function waitForBootstrapPayload() {
  const requestUrl = new URL(window.location.href);
  const action = requestUrl.searchParams.get('action') === 'pdf' ? 'pdf' : 'docx';
  const filePath = requestUrl.searchParams.get('file') || '';
  const jobId = requestUrl.searchParams.get('job') || '';

  if (jobId && window.opener && !window.opener.closed) {
    postExportPageMessage('ready', { jobId });

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for export data'));
      }, 10000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        window.removeEventListener('message', handleMessage);
      };

      const handleMessage = (event) => {
        if (event.origin !== window.location.origin) {
          return;
        }

        const payload = event.data;
        if (!payload || payload.source !== EXPORT_HOST_SOURCE || payload.type !== 'bootstrap' || payload.jobId !== jobId) {
          return;
        }

        cleanup();
        resolve({
          action,
          fileList: Array.isArray(payload.fileList) ? payload.fileList : [],
          filePath: payload.filePath || filePath,
          title: payload.title || '',
          markdownText: payload.markdownText || '',
        });
      };

      window.addEventListener('message', handleMessage);
    });
  }

  return {
    action,
    fileList: [],
    filePath,
    markdownText: filePath ? await fetchTextFile(filePath) : '',
    title: '',
  };
}
