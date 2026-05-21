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

export function isSinglePageFlagValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }
  return normalized !== '0';
}

export function isSinglePageHash(hash = '') {
  const params = getHashParamsFromRaw(hash);
  return params.has('single') && isSinglePageFlagValue(params.get('single'));
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

export function createFileRouteHash(filePath, {
  anchor = null,
  column = null,
  drawioMode = null,
  line = null,
  matchLength = null,
} = {}) {
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
  if (line != null) {
    params.set('line', String(Math.max(1, Math.round(Number(line) || 1))));
  }
  if (column != null) {
    params.set('column', String(Math.max(1, Math.round(Number(column) || 1))));
  }
  if (matchLength != null) {
    params.set('matchLength', String(Math.max(0, Math.round(Number(matchLength) || 0))));
  }
  return params.toString();
}
