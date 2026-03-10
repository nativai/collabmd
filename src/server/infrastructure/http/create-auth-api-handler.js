import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

function applyAuthResponse(req, res, result) {
  if (result?.setCookie) {
    res.setHeader('Set-Cookie', result.setCookie);
  }

  jsonResponse(req, res, result?.statusCode ?? 200, result?.body ?? { ok: true });
  return true;
}

export function createAuthApiHandler({ authService }) {
  return async function handleAuthApi(req, res, requestUrl) {
    if (!(requestUrl.pathname === '/api/auth' || requestUrl.pathname.startsWith('/api/auth/'))) {
      return false;
    }

    if (requestUrl.pathname === '/api/auth/status' && req.method === 'GET') {
      return applyAuthResponse(req, res, authService.getStatus(req));
    }

    if (requestUrl.pathname === '/api/auth/session' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        return applyAuthResponse(req, res, authService.createSession(req, body));
      } catch (error) {
        const statusCode = getRequestErrorStatusCode(error);
        if (statusCode) {
          jsonResponse(req, res, statusCode, { error: error.message });
          return true;
        }

        console.error('[api] Failed to create auth session:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to create auth session' });
        return true;
      }
    }

    if (requestUrl.pathname === '/api/auth/session' && req.method === 'DELETE') {
      return applyAuthResponse(req, res, authService.clearSession(req));
    }

    jsonResponse(req, res, 404, { error: 'Auth endpoint not found' });
    return true;
  };
}
