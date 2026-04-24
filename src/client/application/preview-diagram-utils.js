export const MERMAID_ZOOM = {
  default: 1,
  animationDurationMs: 160,
  max: 3,
  min: 0.5,
  step: 0.1,
};

export const PLANTUML_ZOOM = {
  default: 1,
  animationDurationMs: 160,
  max: 3,
  min: 0.1,
  step: 0.1,
};

export const IDLE_RENDER_TIMEOUT_MS = 500;
export const MERMAID_BATCH_SIZE = 2;
export const PLANTUML_BATCH_SIZE = 2;

export function requestIdleRender(callback, timeout) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, 1);
}

export function cancelIdleRender(id) {
  if (id === null) {
    return;
  }

  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(id);
    return;
  }

  window.clearTimeout(id);
}

export function syncAttribute(target, source, name) {
  const nextValue = source.getAttribute(name);
  if (nextValue === null) {
    target.removeAttribute(name);
    return;
  }

  target.setAttribute(name, nextValue);
}

export function getSvgSize(svg) {
  const viewBox = svg.viewBox?.baseVal;
  const attributeWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const attributeHeight = Number.parseFloat(svg.getAttribute('height') || '');
  const rect = svg.getBoundingClientRect();
  const bbox = typeof svg.getBBox === 'function' ? svg.getBBox() : null;

  return {
    height: viewBox?.height || bbox?.height || attributeHeight || rect.height || 480,
    width: viewBox?.width || bbox?.width || attributeWidth || rect.width || 640,
  };
}

export function normalizeMermaidSvg(svg) {
  if (!svg || typeof svg.getBBox !== 'function') {
    return getSvgSize(svg);
  }

  try {
    const bbox = svg.getBBox();
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
      return getSvgSize(svg);
    }

    const padding = 16;
    const x = bbox.x - padding;
    const y = bbox.y - padding;
    const width = bbox.width + (padding * 2);
    const height = bbox.height + (padding * 2);

    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    return { width, height };
  } catch {
    return getSvgSize(svg);
  }
}

export function getFrameViewportSize(frame) {
  const styles = window.getComputedStyle(frame);
  const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
  const paddingY = Number.parseFloat(styles.paddingTop || '0') + Number.parseFloat(styles.paddingBottom || '0');

  return {
    height: Math.max(frame.clientHeight - paddingY, 0),
    width: Math.max(frame.clientWidth - paddingX, 0),
  };
}

export function easeOutCubic(progress) {
  return 1 - ((1 - progress) ** 3);
}

export function createMermaidPlaceholderCard(key) {
  return createMermaidPlaceholderCardWithMessage(key, {
    label: 'Mermaid diagram',
    message: 'Loads when visible',
  });
}

export function createMermaidPlaceholderCardWithMessage(key, { label = 'Mermaid diagram', message = 'Loads when visible' } = {}) {
  const card = document.createElement('div');
  card.className = 'mermaid-placeholder-card';

  const copy = document.createElement('div');
  copy.className = 'mermaid-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = label;

  const subtitle = document.createElement('span');
  subtitle.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mermaid-placeholder-btn';
  button.dataset.mermaidKey = key;
  button.textContent = 'Render';

  copy.append(title, subtitle);
  card.append(copy, button);
  return card;
}

export function createPlantUmlPlaceholderCard(key, message = 'Renders server-side when visible') {
  const card = document.createElement('div');
  card.className = 'plantuml-placeholder-card';

  const copy = document.createElement('div');
  copy.className = 'plantuml-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = 'PlantUML diagram';

  const subtitle = document.createElement('span');
  subtitle.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plantuml-placeholder-btn';
  button.dataset.plantumlKey = key;
  button.textContent = 'Render';

  copy.append(title, subtitle);
  card.append(copy, button);
  return card;
}

export function sanitizeSvgMarkup(svgMarkup) {
  const markupWithoutComments = String(svgMarkup ?? '').replace(/<!--[\s\S]*?-->/gu, '');
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(markupWithoutComments, 'image/svg+xml');
  const svg = documentNode.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Renderer returned invalid SVG');
  }

  documentNode.querySelectorAll('script, foreignObject').forEach((node) => {
    node.remove();
  });

  Array.from(documentNode.querySelectorAll('*')).forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || '';
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        return;
      }

      if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return svg.outerHTML;
}

export function shouldPreserveHydratedDiagram({ nextSource = '', nextTarget = '', preservedSource = '', preservedTarget = '' } = {}) {
  if (nextSource) {
    return nextSource === preservedSource;
  }

  if (nextTarget) {
    return nextTarget === preservedTarget;
  }

  return false;
}

export function isNearViewport(element, root, marginPx) {
  if (!element || !root) {
    return false;
  }

  const rootRect = root.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  return (
    elementRect.bottom >= (rootRect.top - marginPx)
    && elementRect.top <= (rootRect.bottom + marginPx)
  );
}
