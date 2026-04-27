export const HASH_ROUTE_KEYS = Object.freeze({
  authError: 'auth_error',
  authPassword: 'auth_password',
  file: 'file',
  gitCommit: 'git-commit',
  gitDiff: 'git-diff',
  gitFileHistory: 'git-file-history',
  gitFilePreview: 'git-file-preview',
  gitHistory: 'git-history',
});

export function getHashParamsFromRaw(hash = '') {
  const rawHash = String(hash ?? '');
  const normalizedHash = rawHash.startsWith('#')
    ? rawHash.slice(1)
    : rawHash;
  return new URLSearchParams(normalizedHash);
}

function getNormalizedHash(hash = '') {
  const rawHash = String(hash ?? '');
  return rawHash.startsWith('#')
    ? rawHash.slice(1)
    : rawHash;
}

export function isCollabMdHashRoute(hash = '') {
  const normalizedHash = getNormalizedHash(hash).trim();
  if (!normalizedHash.includes('=')) {
    return false;
  }

  const params = getHashParamsFromRaw(hash);
  return Object.values(HASH_ROUTE_KEYS).some((key) => params.has(key));
}

export function createFileRouteHash(filePath, { drawioMode = null, anchor = null } = {}) {
  const params = new URLSearchParams();
  if (filePath) {
    params.set(HASH_ROUTE_KEYS.file, filePath);
  }
  if (drawioMode) {
    params.set('drawio', drawioMode);
  }
  if (anchor) {
    params.set('anchor', String(anchor).trim());
  }
  return params.toString();
}
