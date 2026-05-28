import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiagramChrome } from '../../src/client/application/diagram-chrome.js';

function createSvg({ height = 80, label = 'Diagram', width = 120 } = {}) {
  const shell = document.createElement('div');
  shell.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><text x="4" y="20">${label}</text></svg>`;
  return shell.querySelector('svg');
}

function mountDiagram(chrome, kind, { label = kind } = {}) {
  const shell = document.createElement('div');
  shell.className = `${kind}-shell diagram-preview-shell`;
  const source = document.createElement('span');
  source.className = `${kind}-source`;
  source.hidden = true;
  source.textContent = `${kind} source`;
  shell.append(source);
  document.body.append(shell);

  chrome.mount(shell, {
    baseHeight: 80,
    baseWidth: 120,
    diagramElement: createSvg({ label }),
    exportFileNames: () => ({ pngFileName: `${kind}.png`, svgFileName: `${kind}.svg` }),
    exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    kind,
    sourceSelector: `.${kind}-source`,
  });

  return shell;
}

describe('DiagramChrome', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('mounts Mermaid chrome with existing diagram-specific classes', () => {
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { label: 'Start' });

    expect(shell.querySelector('.mermaid-toolbar.diagram-preview-toolbar')).not.toBeNull();
    expect(shell.querySelector('.mermaid-frame.diagram-preview-frame svg')).not.toBeNull();
    expect(shell.querySelector('.mermaid-zoom-btn[aria-label="Zoom in"]')).not.toBeNull();
    expect(shell.querySelector('.mermaid-zoom-btn[aria-label="Download SVG"]')).not.toBeNull();
    expect(shell.querySelector('.mermaid-source')?.textContent).toBe('mermaid source');
  });

  it('maximizes one diagram at a time across Mermaid and PlantUML', () => {
    const chrome = new DiagramChrome();
    const mermaidShell = mountDiagram(chrome, 'mermaid');
    const plantUmlShell = mountDiagram(chrome, 'plantuml');

    mermaidShell.querySelector('.mermaid-maximize-btn')?.click();

    expect(document.body.classList.contains('mermaid-maximized-open')).toBe(true);
    expect(document.querySelector('[data-mermaid-maximized-root="true"] .mermaid-shell.is-maximized')).toBe(mermaidShell);
    expect(mermaidShell.querySelector('.mermaid-maximize-btn')?.getAttribute('aria-label')).toBe('Restore diagram size');

    plantUmlShell.querySelector('.plantuml-maximize-btn')?.click();

    expect(mermaidShell.classList.contains('is-maximized')).toBe(false);
    expect(document.body.classList.contains('mermaid-maximized-open')).toBe(false);
    expect(document.body.classList.contains('plantuml-maximized-open')).toBe(true);
    expect(document.querySelector('[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized')).toBe(plantUmlShell);
    expect(mermaidShell.querySelector('.mermaid-maximize-btn')?.getAttribute('aria-label')).toBe('Maximize diagram');

    plantUmlShell.querySelector('.plantuml-maximize-btn')?.click();

    expect(plantUmlShell.classList.contains('is-maximized')).toBe(false);
    expect(document.body.classList.contains('plantuml-maximized-open')).toBe(false);
    expect(plantUmlShell.querySelector('.plantuml-maximize-btn')?.getAttribute('aria-label')).toBe('Maximize diagram');
  });

  it('renders a PlantUML reload action when supplied by the adapter', () => {
    const onReload = vi.fn();
    const chrome = new DiagramChrome();
    const shell = document.createElement('div');
    shell.className = 'plantuml-shell diagram-preview-shell';
    document.body.append(shell);

    chrome.mount(shell, {
      baseHeight: 80,
      baseWidth: 120,
      diagramElement: createSvg(),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'plantuml',
      onReload,
    });

    shell.querySelector('.plantuml-tool-btn[aria-label="Reload diagram"]')?.click();

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
