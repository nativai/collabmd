/**
 * PgBacklinkProvider — answers the Backlinks panel from the Postgres search store
 * (`wisdom_docs`, written by the co-located search engine) instead of holding an
 * in-memory index of the whole vault. Selected by COLLABMD_BACKLINKS_SOURCE=postgres;
 * the default remains BacklinkIndex.
 *
 * getBacklinks(target) unions three parts, each keyed by source path (first wins):
 *   1. a recent-edits overlay — sources seen by updateFile / applyWorkspaceChange in the
 *      last `overlayWindowMs`, re-extracted from their current content;
 *   2. a gap index — the existing BacklinkIndex built over ONLY the markdown files that
 *      `wisdom_docs` lacks (or holds cut at the store's size cap);
 *   3. Postgres candidates — documents whose text contains a literal that can resolve to
 *      the target, CONFIRMED with the same collectMarkdownReferences + wiki target index
 *      the in-memory index uses, so link resolution is identical.
 * When Postgres fails or is slow, parts 1 and 2 are returned and one warning is logged.
 */

import { BacklinkIndex } from './backlink-index.js';
import { createWikiTargetIndex, resolveWikiTargetWithIndex } from '../../domain/wiki-link-resolver.js';
import { isImageAttachmentFilePath, isMarkdownFilePath } from '../../domain/file-kind.js';
import {
  collectMarkdownReferences,
  collectReferenceTargetKeysForFilePath,
} from './markdown-reference-extractor.js';

const CANDIDATE_PAGE_SIZE = 100;
const GAP_LIST_TIMEOUT_MS = 30_000;

/**
 * The store cuts a document's `text` at 4 MiB UTF-16 code units. A cut document may have
 * lost links, so it is indexed from disk (gap index) instead. UTF-8 bytes >= UTF-16 units
 * for every character, so `octet_length >= cap` catches every cut document (plus a few
 * long non-ASCII ones, which the gap index serves just as well). octet_length on a TOASTed
 * value reads the stored header only; it does not detoast the 38k texts.
 */
export const STORE_TEXT_CAP_CHARS = 4 * 1024 * 1024;

export const GAP_LIST_SQL = `SELECT path, octet_length(text) >= ${STORE_TEXT_CAP_CHARS} AS cut FROM wisdom_docs`;

/**
 * The literals a source must contain for one of its references to resolve to targetPath.
 * Every wiki reference that resolves to targetPath has a raw target that is one of the
 * target's own reference keys (path suffixes, with and without `.md`) — those keys are
 * filtered to the ones that resolve to targetPath under the CURRENT index (an ambiguous
 * basename that resolves elsewhere is dropped). A relative markdown image reference
 * contains the image's basename (possibly percent-encoded). A literal that contains
 * another literal is redundant for a substring filter and removed.
 */
export function buildCandidateLiterals(targetPath, wikiTargetIndex) {
  const literals = collectReferenceTargetKeysForFilePath(targetPath)
    .filter((key) => resolveWikiTargetWithIndex(key, wikiTargetIndex) === targetPath);
  if (isImageAttachmentFilePath(targetPath)) {
    const basename = targetPath.split('/').pop();
    literals.push(basename, encodeURIComponent(basename));
  }

  const unique = [...new Set(literals.filter(Boolean))];
  return unique.filter((literal) => !unique.some((other) => other !== literal && literal.includes(other)));
}

/**
 * One page of candidates. The BM25 phrase predicate (`###`, tokenized by the index's own
 * `text` tokenizer) makes it an index scan; strpos keeps only rows that literally contain
 * a literal (case-sensitive, like the resolver). A literal without any letter or digit
 * yields no tokens, so a phrase on it would match nothing: then the phrase predicate is
 * omitted and strpos alone decides.
 */
export function buildCandidateQuery(literals, { afterPath = '', limit = CANDIDATE_PAGE_SIZE } = {}) {
  const literalParams = literals.map((_, index) => `$${index + 1}::text`);
  const conditions = [];
  if (literals.every((literal) => /[\p{L}\p{N}]/u.test(literal))) {
    conditions.push(`(${literalParams.map((param) => `text ### ${param}`).join(' OR ')})`);
  }
  conditions.push(`(${literalParams.map((param) => `strpos(text, ${param}) > 0`).join(' OR ')})`);
  conditions.push(`path > $${literals.length + 1}::text`);

  return {
    text: `SELECT path, text FROM wisdom_docs WHERE ${conditions.join(' AND ')} ORDER BY path LIMIT $${literals.length + 2}::int`,
    values: [...literals, afterPath, limit],
  };
}

function withTimeout(promise, timeoutMs, label, { setTimeoutFn, clearTimeoutFn }) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeoutFn(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    timer?.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeoutFn(timer));
}

export class PgBacklinkProvider {
  constructor({
    clearIntervalFn = clearInterval,
    clearTimeoutFn = clearTimeout,
    gapRefreshMs = 300_000,
    logger = console,
    maxCandidates = 500,
    now = Date.now,
    overlayWindowMs = 600_000,
    pg,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
    timeoutMs = 2_000,
    vaultFileStore,
  }) {
    this.requiresStartupBuild = false;
    this.pg = pg;
    this.vaultFileStore = vaultFileStore;
    this.timeoutMs = timeoutMs;
    this.overlayWindowMs = overlayWindowMs;
    this.gapRefreshMs = gapRefreshMs;
    this.maxCandidates = maxCandidates;
    this.logger = logger;
    this.now = now;
    this.timers = { clearIntervalFn, clearTimeoutFn, setIntervalFn, setTimeoutFn };

    this._filePaths = [];
    this._fileSet = new Set();
    this._markdownSet = new Set();
    this._wikiTargetIndex = createWikiTargetIndex([]);
    /** @type {Map<string, { content: string, at: number }>} */
    this._overlay = new Map();
    this._gapSet = new Set();
    this._gapIndex = null;
    this._needsFullGapBuild = true;
    this._refreshPromise = null;
    this._refreshAgain = false;
    this._refreshTimer = null;
    this._pgHealthy = true;
  }

  /** Called once the server listens: adopt the snapshot, then build the gap index in the background. */
  start({ workspaceState } = {}) {
    this._setWorkspace(workspaceState);
    if (!this._refreshTimer) {
      this._refreshTimer = this.timers.setIntervalFn(() => {
        void this.refreshGapSet();
      }, this.gapRefreshMs);
      this._refreshTimer?.unref?.();
    }
    return this.refreshGapSet();
  }

  async close() {
    if (this._refreshTimer) {
      this.timers.clearIntervalFn(this._refreshTimer);
      this._refreshTimer = null;
    }
    await this._refreshPromise?.catch(() => {});
    await this.pg?.end?.();
  }

  /** No full-vault build exists in this mode (the test reset endpoint calls this). */
  async build() {}

  /** The ">25 paths changed" path: adopt the new snapshot and rebuild the gap index from it. */
  scheduleBuild({ workspaceState } = {}) {
    if (workspaceState) {
      this._setWorkspace(workspaceState);
    }
    this._needsFullGapBuild = true;
    return this.refreshGapSet();
  }

  updateFile(filePath, content, { refreshIndex = true } = {}) {
    if (!this._fileSet.has(filePath)) {
      this._fileSet.add(filePath);
      this._filePaths.push(filePath);
      if (refreshIndex) {
        this._wikiTargetIndex = createWikiTargetIndex(this._filePaths);
      }
    }

    if (!isMarkdownFilePath(filePath)) {
      return;
    }

    this._markdownSet.add(filePath);
    this._overlay.set(filePath, { at: this.now(), content });
    if (this._gapSet.has(filePath)) {
      this._gapIndex?.updateFile(filePath, content, { refreshIndex });
    }
  }

  async applyWorkspaceChange(workspaceChange = {}, { previousState = null, nextState = null } = {}) {
    if (nextState) {
      this._setWorkspace(nextState);
    }

    for (const pathValue of workspaceChange.deletedPaths ?? []) {
      this._overlay.delete(pathValue);
    }
    for (const entry of workspaceChange.renamedPaths ?? []) {
      if (entry?.oldPath) {
        this._overlay.delete(entry.oldPath);
      }
    }

    const touchedPaths = new Set([
      ...(workspaceChange.changedPaths ?? []),
      ...(workspaceChange.renamedPaths ?? []).map((entry) => entry?.newPath),
    ].filter((pathValue) => pathValue && isMarkdownFilePath(pathValue) && this._markdownSet.has(pathValue)));

    for (const pathValue of touchedPaths) {
      const content = await this.vaultFileStore.readMarkdownFile(pathValue);
      if (content !== null) {
        this._overlay.set(pathValue, { at: this.now(), content });
      }
    }

    if (this._gapIndex) {
      await this._gapIndex.applyWorkspaceChange(workspaceChange, { nextState, previousState });
      // applyWorkspaceChange indexes every changed markdown file; keep the gap index to gap sources.
      touchedPaths.forEach((pathValue) => {
        if (!this._gapSet.has(pathValue)) {
          this._gapIndex.updateFile(pathValue, '', { refreshIndex: false });
        }
      });
    }

    if (this._refreshPromise) {
      // A gap build in flight started from the previous snapshot.
      this._needsFullGapBuild = true;
    }
  }

  async getBacklinks(targetPath) {
    this._pruneOverlay();
    /** @type {Map<string, string[]>} */
    const bySource = new Map();

    for (const [sourcePath, { content }] of this._overlay) {
      if (!this._markdownSet.has(sourcePath)) {
        continue;
      }
      const contexts = this._contextsFor(sourcePath, content, targetPath);
      if (contexts.length > 0) {
        bySource.set(sourcePath, contexts);
      }
    }

    if (this._gapIndex) {
      for (const { file, contexts } of await this._gapIndex.getBacklinks(targetPath)) {
        if (this._gapSet.has(file) && this._markdownSet.has(file) && !this._overlay.has(file)) {
          bySource.set(file, contexts);
        }
      }
    }

    try {
      await this._collectPostgresBacklinks(targetPath, bySource);
      this._markPostgresHealthy();
    } catch (error) {
      this._markPostgresFailed(error);
    }

    const results = [];
    for (const [file, contexts] of bySource) {
      results.push({ file, contexts });
    }
    results.sort((a, b) => a.file.localeCompare(b.file));
    return results;
  }

  /** Re-read the store's path list and bring the gap index up to date. Never rejects. */
  refreshGapSet() {
    if (this._refreshPromise) {
      this._refreshAgain = true;
      return this._refreshPromise;
    }

    this._refreshPromise = (async () => {
      do {
        this._refreshAgain = false;
        await this._refreshGapSetOnce();
      } while (this._refreshAgain);
    })().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  // --- Private methods ---

  _setWorkspace(workspaceState) {
    // Same derivation as BacklinkIndex._performBuild, so both resolve against the same list in the same order.
    this._workspaceState = workspaceState ?? null;
    this._filePaths = Array.from(workspaceState?.filePaths ?? workspaceState?.markdownPaths ?? []);
    this._fileSet = new Set(this._filePaths);
    this._markdownSet = new Set(Array.from(
      workspaceState?.markdownPaths ?? this._filePaths.filter((filePath) => isMarkdownFilePath(filePath)),
    ).filter((filePath) => this._fileSet.has(filePath)));
    this._wikiTargetIndex = createWikiTargetIndex(this._filePaths);
  }

  _contextsFor(sourcePath, content, targetPath) {
    // The store's `text` starts with a line of the document's path words (letters, digits,
    // spaces). That line cannot form a reference, so the text is used as stored.
    return collectMarkdownReferences(content, {
      sourceFilePath: sourcePath,
      wikiTargetIndex: this._wikiTargetIndex,
    })
      .filter((reference) => reference.resolvedPath === targetPath && reference.resolvedPath !== sourcePath)
      .map((reference) => reference.context);
  }

  async _collectPostgresBacklinks(targetPath, bySource) {
    if (!this.pg || !this._wikiTargetIndex.exactPaths.has(targetPath)) {
      return;
    }
    const literals = buildCandidateLiterals(targetPath, this._wikiTargetIndex);
    if (literals.length === 0) {
      return;
    }

    const deadline = this.now() + this.timeoutMs;
    let afterPath = '';
    let fetched = 0;
    while (fetched < this.maxCandidates) {
      const limit = Math.min(CANDIDATE_PAGE_SIZE, this.maxCandidates - fetched);
      const remainingMs = Math.max(1, deadline - this.now());
      const { rows } = await this._query({
        ...buildCandidateQuery(literals, { afterPath, limit }),
        query_timeout: remainingMs,
      }, remainingMs, 'backlink candidate query');

      for (const row of rows) {
        const sourcePath = row.path;
        if (
          bySource.has(sourcePath)
          || this._overlay.has(sourcePath)
          || this._gapSet.has(sourcePath)
          || !this._markdownSet.has(sourcePath)
        ) {
          continue;
        }
        const contexts = this._contextsFor(sourcePath, row.text ?? '', targetPath);
        if (contexts.length > 0) {
          bySource.set(sourcePath, contexts);
        }
      }

      fetched += rows.length;
      if (rows.length < limit) {
        return;
      }
      afterPath = rows[rows.length - 1].path;
    }

    this.logger.warn(`[backlinks] ${targetPath}: candidate cap of ${this.maxCandidates} reached; Postgres backlinks may be incomplete`);
  }

  _query(queryConfig, timeoutMs, label) {
    return withTimeout(Promise.resolve().then(() => this.pg.query(queryConfig)), timeoutMs, label, this.timers);
  }

  async _refreshGapSetOnce() {
    let rows;
    try {
      ({ rows } = await this._query({ query_timeout: GAP_LIST_TIMEOUT_MS, text: GAP_LIST_SQL }, GAP_LIST_TIMEOUT_MS, 'backlink gap path list'));
      this._markPostgresHealthy();
    } catch (error) {
      this._markPostgresFailed(error);
      return;
    }

    try {
      const storedPaths = new Set();
      rows.forEach((row) => {
        if (!row.cut) {
          storedPaths.add(row.path);
        }
      });
      const markdownPaths = Array.from(this._markdownSet);
      const nextGap = new Set(markdownPaths.filter((filePath) => !storedPaths.has(filePath)));
      const overlap = markdownPaths.length - nextGap.size;
      this.logger.log(`[backlinks] gap refresh: ${markdownPaths.length} markdown sources, ${rows.length} store rows, ${overlap} in both, ${nextGap.size} gap`);
      if (overlap === 0 && markdownPaths.length > 0) {
        this.logger.warn('[backlinks] no workspace markdown path is present in wisdom_docs; check that the store holds vault-relative paths');
      }

      if (!this._gapIndex || this._needsFullGapBuild) {
        this._needsFullGapBuild = false;
        const gapIndex = new BacklinkIndex({ vaultFileStore: this.vaultFileStore });
        await gapIndex.build({
          workspaceState: { filePaths: this._filePaths, markdownPaths: Array.from(nextGap) },
        });
        this._gapIndex = gapIndex;
      } else {
        for (const filePath of this._gapSet) {
          if (!nextGap.has(filePath)) {
            this._gapIndex.updateFile(filePath, '', { refreshIndex: false });
          }
        }
        for (const filePath of nextGap) {
          if (!this._gapSet.has(filePath)) {
            const content = await this.vaultFileStore.readMarkdownFile(filePath);
            this._gapIndex.updateFile(filePath, content ?? '', { refreshIndex: false });
          }
        }
      }
      this._gapSet = nextGap;
      this._pruneOverlay();
    } catch (error) {
      this.logger.warn(`[backlinks] gap index refresh failed: ${error.message}`);
    }
  }

  _pruneOverlay() {
    const oldest = this.now() - this.overlayWindowMs;
    for (const [filePath, entry] of this._overlay) {
      if (entry.at < oldest || !this._markdownSet.has(filePath)) {
        this._overlay.delete(filePath);
      }
    }
  }

  _markPostgresFailed(error) {
    if (this._pgHealthy) {
      this._pgHealthy = false;
      this.logger.warn(`[backlinks] Postgres unavailable (${error?.message ?? error}); serving recent edits and gap files only until it recovers`);
    }
  }

  _markPostgresHealthy() {
    if (!this._pgHealthy) {
      this._pgHealthy = true;
      this.logger.log('[backlinks] Postgres reachable again');
    }
  }
}

/** A lazily created `pg` Pool: the dependency is loaded on the first query, never at startup. */
export function createPgDocsClient({
  database,
  host,
  password,
  port = 5432,
  sslmode = 'require',
  timeoutMs = 2_000,
  user,
}) {
  let poolPromise = null;
  const getPool = () => {
    poolPromise ??= import('pg').then(({ default: pg }) => {
      const pool = new pg.Pool({
        application_name: 'collabmd-backlinks',
        connectionTimeoutMillis: timeoutMs,
        database,
        host,
        idleTimeoutMillis: 30_000,
        max: 2,
        password,
        port,
        ssl: sslmode === 'disable' ? false : { rejectUnauthorized: sslmode === 'verify-full' },
        statement_timeout: GAP_LIST_TIMEOUT_MS,
        user,
      });
      // An idle client's error is emitted on the pool; unhandled it would crash the process.
      pool.on('error', (error) => {
        console.warn(`[backlinks] idle Postgres client error: ${error.message}`);
      });
      return pool;
    });
    return poolPromise;
  };

  return {
    async end() {
      if (poolPromise) {
        await (await poolPromise).end();
      }
    },
    async query(queryConfig) {
      return (await getPool()).query(queryConfig);
    },
  };
}
