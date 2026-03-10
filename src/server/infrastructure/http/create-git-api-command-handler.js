import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

async function parseRequiredBody(req, res, fieldName) {
  const body = await parseJsonBody(req);
  if (!body?.[fieldName]) {
    jsonResponse(req, res, 400, { error: `Missing ${fieldName}` });
    return null;
  }

  return body;
}

function handleGitError(req, res, error, logMessage, fallbackMessage) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    jsonResponse(req, res, statusCode, { error: error.message });
    return true;
  }

  console.error(logMessage, error.message);
  jsonResponse(req, res, 500, { error: fallbackMessage });
  return true;
}

export function createGitApiCommandHandler({ gitService }) {
  return async function handleGitApiCommand(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/git/stage' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await gitService.stageFile(body.path));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to stage git file:', 'Failed to stage git file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/unstage' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await gitService.unstageFile(body.path));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to unstage git file:', 'Failed to unstage git file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/commit' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'message');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await gitService.commitStaged({
          message: body.message,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to commit staged changes:', 'Failed to commit staged changes');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/push' && req.method === 'POST') {
      try {
        jsonResponse(req, res, 200, await gitService.pushBranch());
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to push git branch:', 'Failed to push git branch');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/pull' && req.method === 'POST') {
      try {
        jsonResponse(req, res, 200, await gitService.pullBranch());
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to pull git branch:', 'Failed to pull git branch');
      }
      return true;
    }

    return false;
  };
}
