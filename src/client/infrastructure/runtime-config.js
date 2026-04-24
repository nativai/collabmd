import {
  getClientRuntimeConfig,
  resolveApiUrl,
  resolveAppPath,
  resolveAppUrl,
  resolveWsBaseUrl,
} from '../domain/runtime-paths.js';
import {
  createFileRouteHash,
  getHashParamsFromRaw,
  HASH_ROUTE_KEYS,
  isCollabMdHashRoute,
} from '../domain/hash-routes.js';

export function getRuntimeConfig() {
  return getClientRuntimeConfig();
}

export { resolveApiUrl, resolveAppPath, resolveAppUrl, resolveWsBaseUrl };
export { createFileRouteHash, isCollabMdHashRoute };

function getHashParams() {
  return getHashParamsFromRaw(window.location.hash);
}

function normalizeDiffScope(scope) {
  if (scope === 'staged' || scope === 'all' || scope === 'working-tree') {
    return scope;
  }

  return 'all';
}

export function getHashRoute() {
  const params = getHashParams();

  if (params.has(HASH_ROUTE_KEYS.gitFilePreview)) {
    const historicalFilePath = params.get(HASH_ROUTE_KEYS.gitFilePreview) || null;
    return {
      currentFilePath: params.get('current') || historicalFilePath,
      filePath: historicalFilePath,
      hash: params.get('hash') || null,
      type: 'git-file-preview',
    };
  }

  if (params.has(HASH_ROUTE_KEYS.gitFileHistory)) {
    return {
      filePath: params.get(HASH_ROUTE_KEYS.gitFileHistory) || null,
      type: 'git-file-history',
    };
  }

  if (params.has(HASH_ROUTE_KEYS.gitHistory)) {
    return { type: 'git-history' };
  }

  if (params.has(HASH_ROUTE_KEYS.gitCommit)) {
    return {
      hash: params.get(HASH_ROUTE_KEYS.gitCommit) || null,
      historyFilePath: params.get('history') || null,
      path: params.get('path') || null,
      type: 'git-commit',
    };
  }

  if (params.has(HASH_ROUTE_KEYS.gitDiff)) {
    const filePath = params.get(HASH_ROUTE_KEYS.gitDiff) || null;
    return {
      filePath,
      scope: normalizeDiffScope(params.get('scope') || (filePath ? 'working-tree' : 'all')),
      type: 'git-diff',
    };
  }

  if (params.has(HASH_ROUTE_KEYS.file)) {
    return {
      anchor: params.get('anchor') || null,
      drawioMode: params.get('drawio') || null,
      filePath: params.get(HASH_ROUTE_KEYS.file),
      type: 'file',
    };
  }

  return { type: 'empty' };
}

export function navigateToFile(filePath, { drawioMode = null, anchor = null } = {}) {
  window.location.hash = createFileRouteHash(filePath, { drawioMode, anchor });
}

export function navigateToGitDiff({ filePath = null, scope = 'all' } = {}) {
  const params = new URLSearchParams();
  params.set('git-diff', filePath ?? '');
  params.set('scope', normalizeDiffScope(scope));
  window.location.hash = params.toString();
}

export function navigateToGitCommit({ hash, path = null, historyFilePath = null } = {}) {
  const normalizedHash = String(hash ?? '').trim();
  const params = new URLSearchParams();
  params.set('git-commit', normalizedHash);
  if (historyFilePath) {
    params.set('history', historyFilePath);
  }
  if (path) {
    params.set('path', path);
  }
  window.location.hash = params.toString();
}

export function navigateToGitHistory() {
  const params = new URLSearchParams();
  params.set('git-history', '1');
  window.location.hash = params.toString();
}

export function navigateToGitFileHistory({ filePath } = {}) {
  const params = new URLSearchParams();
  params.set('git-file-history', filePath ?? '');
  window.location.hash = params.toString();
}

export function navigateToGitFilePreview({ hash, path, currentFilePath = null } = {}) {
  const normalizedHash = String(hash ?? '').trim();
  const params = new URLSearchParams();
  params.set('git-file-preview', path ?? '');
  if (currentFilePath) {
    params.set('current', currentFilePath);
  }
  params.set('hash', normalizedHash);
  window.location.hash = params.toString();
}
