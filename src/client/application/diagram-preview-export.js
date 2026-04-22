import {
  isMermaidFilePath,
  isPlantUmlFilePath,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';
import { sanitizeSvgMarkup } from './preview-diagram-utils.js';

function getPathLeaf(pathValue) {
  return String(pathValue ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

function encodeSvgDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

function resolveSvgDimensions(svgElement) {
  const widthAttr = Number.parseFloat(svgElement.getAttribute('width') || '');
  const heightAttr = Number.parseFloat(svgElement.getAttribute('height') || '');
  const viewBox = svgElement.getAttribute('viewBox') || '';
  const viewBoxParts = viewBox.split(/\s+/u).map((value) => Number.parseFloat(value));

  return {
    height: Number.isFinite(heightAttr) && heightAttr > 0
      ? heightAttr
      : (Number.isFinite(viewBoxParts[3]) && viewBoxParts[3] > 0 ? viewBoxParts[3] : 800),
    width: Number.isFinite(widthAttr) && widthAttr > 0
      ? widthAttr
      : (Number.isFinite(viewBoxParts[2]) && viewBoxParts[2] > 0 ? viewBoxParts[2] : 1200),
  };
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

async function canvasToPngBlob(canvas) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob instanceof Blob) {
      return blob;
    }
  }

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrlToBlob(dataUrl);
}

function dataUrlToBlob(dataUrl) {
  const [header = '', payload = ''] = String(dataUrl).split(',', 2);
  const mimeMatch = header.match(/^data:([^;,]+)?/u);
  const mimeType = mimeMatch?.[1] || 'application/octet-stream';

  if (header.includes(';base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

function cleanupExportSvg(svgElement) {
  const clonedSvg = svgElement.cloneNode(true);
  if (!(clonedSvg instanceof SVGSVGElement)) {
    throw new Error('Renderer returned invalid SVG');
  }

  clonedSvg.style.removeProperty('display');
  clonedSvg.style.removeProperty('margin');
  clonedSvg.style.removeProperty('max-width');
  clonedSvg.style.removeProperty('height');
  clonedSvg.style.removeProperty('width');
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const { width, height } = resolveSvgDimensions(clonedSvg);
  clonedSvg.setAttribute('width', String(Math.max(1, Math.ceil(width))));
  clonedSvg.setAttribute('height', String(Math.max(1, Math.ceil(height))));

  return clonedSvg;
}

export function createDiagramExportBaseName({
  currentFilePath = '',
  diagramKind = 'diagram',
  sourceLine = '',
  targetPath = '',
} = {}) {
  const targetLeaf = getPathLeaf(targetPath);
  if (targetLeaf) {
    return stripVaultFileExtension(targetLeaf) || `${diagramKind}-diagram`;
  }

  const currentLeaf = getPathLeaf(currentFilePath);
  const currentStem = stripVaultFileExtension(currentLeaf) || 'document';
  const isStandaloneDiagram = (
    (diagramKind === 'mermaid' && isMermaidFilePath(currentFilePath))
    || (diagramKind === 'plantuml' && isPlantUmlFilePath(currentFilePath))
  );

  if (isStandaloneDiagram) {
    return currentStem;
  }

  if (sourceLine) {
    return `${currentStem}-${diagramKind}-L${sourceLine}`;
  }

  return `${currentStem}-${diagramKind}`;
}

export function createDiagramExportFileNames(options = {}) {
  const baseName = createDiagramExportBaseName(options);
  return {
    baseName,
    pngFileName: `${baseName}.png`,
    svgFileName: `${baseName}.svg`,
  };
}

export function exportSvgMarkupFromElement(svgElement) {
  const cleanedSvg = cleanupExportSvg(svgElement);
  return sanitizeSvgMarkup(cleanedSvg.outerHTML);
}

export async function rasterizeSvgMarkupToPngBlob(svgMarkup) {
  const safeSvgMarkup = sanitizeSvgMarkup(svgMarkup);
  const image = await loadImage(encodeSvgDataUrl(safeSvgMarkup));

  const probe = document.createElement('div');
  probe.innerHTML = safeSvgMarkup;
  const svgElement = probe.querySelector('svg');
  const { width, height } = svgElement
    ? resolveSvgDimensions(svgElement)
    : {
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
  return canvasToPngBlob(canvas);
}

export function downloadBlob(blob, fileName) {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

export async function writeBlobToClipboard(blob) {
  if (typeof ClipboardItem !== 'function' || !navigator.clipboard?.write) {
    throw new Error('Clipboard image copy is unavailable');
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob,
    }),
  ]);
}
