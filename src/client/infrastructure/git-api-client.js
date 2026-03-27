import { resolveApiUrl } from '../domain/runtime-paths.js';

function createRequestHeaders(requestId, headers = {}) {
  const nextHeaders = { ...headers };
  if (requestId) {
    nextHeaders['X-CollabMD-Request-Id'] = String(requestId);
  }

  return nextHeaders;
}

async function parseJsonResponse(response, fallbackError) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || fallbackError);
    error.status = response.status;
    error.body = data;
    if (typeof data?.code === 'string') {
      error.code = data.code;
    }
    throw error;
  }

  return data;
}

function createSearchParams(values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value == null || value === '') {
      return;
    }

    params.set(key, String(value));
  });
  return params;
}

export class GitApiClient {
  async readStatus({ force = false } = {}) {
    const response = await fetch(resolveApiUrl(`/git/status${force ? '?force=true' : ''}`));
    return parseJsonResponse(response, 'Failed to load git status');
  }

  async readPullBackups() {
    const response = await fetch(resolveApiUrl('/git/pull-backups'));
    return parseJsonResponse(response, 'Failed to load pull backups');
  }

  async readHistory({ limit, offset } = {}) {
    const params = createSearchParams({ limit, offset });
    const response = await fetch(resolveApiUrl(`/git/history?${params.toString()}`));
    return parseJsonResponse(response, 'Failed to load git history');
  }

  async readFileHistory({ path, limit, offset } = {}) {
    const params = createSearchParams({ limit, offset, path });
    const response = await fetch(resolveApiUrl(`/git/file-history?${params.toString()}`));
    return parseJsonResponse(response, 'Failed to load file history');
  }

  async readDiff({
    allowLargePatch = false,
    metaOnly = false,
    path = null,
    scope = 'all',
  } = {}) {
    const params = createSearchParams({
      allowLargePatch: allowLargePatch ? 'true' : null,
      metaOnly: metaOnly ? 'true' : null,
      path,
      scope,
    });
    const response = await fetch(resolveApiUrl(`/git/diff?${params.toString()}`));
    return parseJsonResponse(response, 'Failed to load git diff');
  }

  async readCommit({
    allowLargePatch = false,
    hash,
    metaOnly = false,
    path = null,
  } = {}) {
    const params = createSearchParams({
      allowLargePatch: allowLargePatch ? 'true' : null,
      hash,
      metaOnly: metaOnly ? 'true' : null,
      path,
    });
    const response = await fetch(resolveApiUrl(`/git/commit?${params.toString()}`));
    return parseJsonResponse(response, 'Failed to load git commit');
  }

  async readFileSnapshot({ hash, path } = {}) {
    const params = createSearchParams({ hash, path });
    const response = await fetch(resolveApiUrl(`/git/file-snapshot?${params.toString()}`));
    return parseJsonResponse(response, 'Failed to load historical file preview');
  }

  async stageFile({ path, requestId = null } = {}) {
    return this.#postJson('/git/stage', { path }, { requestId, fallbackError: 'Failed to stage file' });
  }

  async unstageFile({ path, requestId = null } = {}) {
    return this.#postJson('/git/unstage', { path }, { requestId, fallbackError: 'Failed to unstage file' });
  }

  async pushBranch({ requestId = null } = {}) {
    return this.#postJson('/git/push', {}, { requestId, fallbackError: 'Failed to push branch' });
  }

  async pullBranch({ requestId = null } = {}) {
    return this.#postJson('/git/pull', {}, { requestId, fallbackError: 'Failed to pull branch' });
  }

  async resetFile({ path, requestId = null } = {}) {
    return this.#postJson('/git/reset-file', { path }, { requestId, fallbackError: 'Failed to reset file' });
  }

  async commit({ message, requestId = null } = {}) {
    return this.#postJson('/git/commit', { message }, { requestId, fallbackError: 'Failed to commit staged changes' });
  }

  async #postJson(path, payload, { fallbackError, requestId = null } = {}) {
    const response = await fetch(resolveApiUrl(path), {
      body: JSON.stringify(payload),
      headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      method: 'POST',
    });
    return parseJsonResponse(response, fallbackError);
  }
}

export const gitApiClient = new GitApiClient();
