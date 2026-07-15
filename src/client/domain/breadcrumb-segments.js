import { normalizeVaultPathInput } from './vault-paths.js';

/**
 * @typedef {object} BreadcrumbSegment
 * @property {string} name  The folder or file name for this segment.
 * @property {string} path  The cumulative vault path up to and including this segment.
 * @property {boolean} isLeaf  True for the trailing file segment, false for ancestor folders.
 */

/**
 * Derive the ordered ancestor breadcrumb segments for a vault file path.
 *
 * Given `a/b/c/file.md` returns cumulative segments:
 *   [{ name: 'a', path: 'a', isLeaf: false },
 *    { name: 'b', path: 'a/b', isLeaf: false },
 *    { name: 'c', path: 'a/b/c', isLeaf: false },
 *    { name: 'file.md', path: 'a/b/c/file.md', isLeaf: true }]
 *
 * Input is normalized first (trailing slashes, backslashes, leading slashes, and
 * empty segments are stripped; `.`/`..` traversal yields an empty result). A path
 * that normalizes to empty returns `[]`.
 *
 * @param {string} filePath
 * @returns {BreadcrumbSegment[]}
 */
export function deriveBreadcrumbSegments(filePath) {
  const normalized = normalizeVaultPathInput(filePath);
  if (!normalized) {
    return [];
  }

  const segments = normalized.split('/');
  const lastIndex = segments.length - 1;
  let cumulativePath = '';

  return segments.map((name, index) => {
    cumulativePath = cumulativePath ? `${cumulativePath}/${name}` : name;
    return {
      name,
      path: cumulativePath,
      isLeaf: index === lastIndex,
    };
  });
}
