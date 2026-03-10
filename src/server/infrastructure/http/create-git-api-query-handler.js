import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';

function resolveDiffScope(requestUrl) {
  const scope = String(requestUrl.searchParams.get('scope') || '').trim().toLowerCase();
  if (scope === 'staged' || scope === 'all' || scope === 'working-tree') {
    return scope;
  }

  if (requestUrl.searchParams.get('staged') === 'true') {
    return 'staged';
  }

  return 'working-tree';
}

function isTruthyParam(value) {
  return value === '1' || value === 'true';
}

function handleGitError(req, res, error, message, fallback) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    jsonResponse(req, res, statusCode, { error: error.message });
    return true;
  }

  console.error(message, error.message);
  jsonResponse(req, res, 500, { error: fallback });
  return true;
}

export function createGitApiQueryHandler({ gitService }) {
  return async function handleGitApiQuery(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/git/status' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getStatus({
          force: isTruthyParam(requestUrl.searchParams.get('force')),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git status:', 'Failed to read git status');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/diff' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getDiff({
          allowLargePatch: isTruthyParam(requestUrl.searchParams.get('allowLargePatch')),
          metaOnly: isTruthyParam(requestUrl.searchParams.get('metaOnly')),
          path: requestUrl.searchParams.get('path'),
          scope: resolveDiffScope(requestUrl),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git diff:', 'Failed to read git diff');
      }
      return true;
    }

    return false;
  };
}
