import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

export function createPlantUmlApiHandler({ plantUmlRenderer = null }) {
  return async function handlePlantUmlApi(req, res, requestUrl) {
    if (!(requestUrl.pathname === '/api/plantuml/render' && req.method === 'POST')) {
      return false;
    }

    try {
      const body = await parseJsonBody(req);
      if (typeof body.source !== 'string') {
        jsonResponse(req, res, 400, { error: 'Missing PlantUML source' });
        return true;
      }

      if (!plantUmlRenderer) {
        jsonResponse(req, res, 503, { error: 'PlantUML renderer is not configured' });
        return true;
      }

      jsonResponse(req, res, 200, {
        ok: true,
        svg: await plantUmlRenderer.renderSvg(body.source),
      });
    } catch (error) {
      const handledStatusCode = getRequestErrorStatusCode(error);
      if (handledStatusCode) {
        jsonResponse(req, res, handledStatusCode, { error: error.message });
        return true;
      }

      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      console.error('[api] Failed to render PlantUML:', error.message);
      jsonResponse(req, res, statusCode, {
        error: error instanceof Error ? error.message : 'Failed to render PlantUML',
      });
    }

    return true;
  };
}
