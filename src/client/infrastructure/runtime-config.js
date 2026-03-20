import {
  getClientRuntimeConfig,
  resolveApiUrl,
  resolveAppPath,
  resolveAppUrl,
  resolveWsBaseUrl,
} from '../domain/runtime-paths.js';

export function getRuntimeConfig() {
  return getClientRuntimeConfig();
}

export { resolveApiUrl, resolveAppPath, resolveAppUrl, resolveWsBaseUrl };

function getHashParams() {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(rawHash);
}

function normalizeDiffScope(scope) {
  if (scope === 'staged' || scope === 'all' || scope === 'working-tree') {
    return scope;
  }

  return 'all';
}

export function getHashRoute() {
  const params = getHashParams();

  if (params.has('git-history')) {
    return { type: 'git-history' };
  }

  if (params.has('git-commit')) {
    return {
      hash: params.get('git-commit') || null,
      path: params.get('path') || null,
      type: 'git-commit',
    };
  }

  if (params.has('git-diff')) {
    const filePath = params.get('git-diff') || null;
    return {
      filePath,
      scope: normalizeDiffScope(params.get('scope') || (filePath ? 'working-tree' : 'all')),
      type: 'git-diff',
    };
  }

  if (params.has('file')) {
    return {
      filePath: params.get('file'),
      type: 'file',
    };
  }

  return { type: 'empty' };
}

export function navigateToFile(filePath) {
  const params = new URLSearchParams();
  if (filePath) {
    params.set('file', filePath);
  }
  window.location.hash = params.toString();
}

export function navigateToGitDiff({ filePath = null, scope = 'all' } = {}) {
  const params = new URLSearchParams();
  params.set('git-diff', filePath ?? '');
  params.set('scope', normalizeDiffScope(scope));
  window.location.hash = params.toString();
}

export function navigateToGitCommit({ hash, path = null } = {}) {
  const normalizedHash = String(hash ?? '').trim();
  const params = new URLSearchParams();
  params.set('git-commit', normalizedHash);
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
