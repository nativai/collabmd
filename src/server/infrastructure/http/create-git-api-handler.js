import { jsonResponse } from './http-response.js';
import { createGitApiCommandHandler } from './create-git-api-command-handler.js';
import { createGitApiQueryHandler } from './create-git-api-query-handler.js';

export function createGitApiHandler({ gitService = null }) {
  const handleGitApiQuery = createGitApiQueryHandler({ gitService });
  const handleGitApiCommand = createGitApiCommandHandler({ gitService });

  return async function handleGitApi(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith('/api/git')) {
      return false;
    }

    if (!gitService) {
      jsonResponse(req, res, 503, { error: 'Git integration is not configured' });
      return true;
    }

    if (await handleGitApiQuery(req, res, requestUrl)) {
      return true;
    }

    if (await handleGitApiCommand(req, res, requestUrl)) {
      return true;
    }

    jsonResponse(req, res, 404, { error: 'Git API endpoint not found' });
    return true;
  };
}
