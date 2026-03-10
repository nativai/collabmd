import { encodePlantUmlText } from '../../domain/plantuml-encoder.js';

function normalizeServerUrl(serverUrl) {
  const value = String(serverUrl || '').trim();
  if (!value) {
    return 'https://www.plantuml.com/plantuml';
  }

  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeSvgPayload(body = '') {
  const normalized = String(body)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*)+/i, '');

  return normalized;
}

export class PlantUmlRenderer {
  constructor({ fetchImpl = fetch, serverUrl } = {}) {
    this.fetchImpl = fetchImpl;
    this.serverUrl = normalizeServerUrl(serverUrl);
  }

  async renderSvg(source = '') {
    const encoded = encodePlantUmlText(source);
    const requestUrl = `${this.serverUrl}/svg/${encoded}`;

    const response = await this.fetchImpl(requestUrl, {
      headers: {
        Accept: 'image/svg+xml, text/plain;q=0.9, */*;q=0.1',
      },
      signal: AbortSignal.timeout(20_000),
    });

    const body = await response.text();

    if (!response.ok) {
      const detail = body.trim() || `Upstream renderer returned ${response.status}`;
      const error = new Error(detail);
      error.statusCode = 502;
      throw error;
    }

    const normalizedSvg = normalizeSvgPayload(body);
    if (!normalizedSvg.startsWith('<svg')) {
      const error = new Error('Upstream renderer returned an invalid SVG payload');
      error.statusCode = 502;
      throw error;
    }

    return normalizedSvg;
  }
}
