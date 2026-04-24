import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadBlob,
  exportSvgMarkupFromElement,
  rasterizeSvgMarkupToPngBlob,
} from '../../src/client/application/diagram-preview-export.js';

describe('diagram preview export helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sanitizes exported SVG markup', () => {
    const shell = document.createElement('div');
    shell.innerHTML = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss = true" viewBox="0 0 120 80" width="120" height="80" style="display:block;width:240px;height:160px">',
      '  <script>alert(1)</script>',
      '  <foreignObject><div>bad</div></foreignObject>',
      '  <!--plantuml-src bad--metadata-->',
      '  <rect width="120" height="80" fill="#fff" />',
      '</svg>',
    ].join('');

    const svg = shell.querySelector('svg');
    expect(svg).not.toBeNull();

    const markup = exportSvgMarkupFromElement(svg);
    expect(markup).not.toContain('onload=');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<foreignObject');
    expect(markup).not.toContain('plantuml-src');
    expect(markup).not.toContain('width:240px');
    expect(markup).toContain('<rect');
  });

  it('rasterizes exported SVG markup into a PNG blob', async () => {
    const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="120" height="80"><rect width="120" height="80" fill="#ffffff"/><circle cx="40" cy="40" r="16" fill="#111827"/></svg>';
    const blob = await rasterizeSvgMarkupToPngBlob(svgMarkup);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('keeps blob download URLs alive until delayed cleanup', () => {
    vi.useFakeTimers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram-export');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadBlob(new Blob(['<svg></svg>'], { type: 'image/svg+xml' }), 'diagram.svg');

    const anchor = document.body.querySelector('a[download="diagram.svg"]');
    expect(anchor).not.toBeNull();
    expect(anchor.href).toBe('blob:diagram-export');
    expect(anchor.style.display).toBe('none');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(document.body.querySelector('a[download="diagram.svg"]')).toBeNull();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:diagram-export');
  });
});
