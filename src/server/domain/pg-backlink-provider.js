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
 *   3. Postgres — candidate sources CONFIRMED with the same collectMarkdownReferences +
 *      wiki target index the in-memory index uses, so link resolution is identical.
 *      Candidates come from a link-key map (raw link target key → store sources) streamed
 *      from the store after listen; until it is ready, from a BM25 phrase query (warm-up).
 * When Postgres is unreachable, parts 1 and 2 are returned and one warning is logged.
 * Design: brick fc8bbde3 conception/C-DESIGN-B.md.
 */

import { BacklinkIndex } from './backlink-index.js';
import { createWikiTargetIndex, resolveWikiTargetWithIndex } from '../../domain/wiki-link-resolver.js';
import { isImageAttachmentFilePath, isMarkdownFilePath } from '../../domain/file-kind.js';
import {
  collectMarkdownReferences,
  collectReferenceTargetKeysForFilePath,
  normalizeReferenceTargetKey,
} from './markdown-reference-extractor.js';

const CANDIDATE_PAGE_SIZE = 100;
const FETCH_CHUNK_SIZE = 100;
const BACKGROUND_QUERY_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 1_000;
/** The client waits this much past the server-side statement_timeout, so the server's cancel lands first. */
const CANCEL_GRACE_MS = 1_000;
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * The store cuts a document's `text` at 4 MiB UTF-16 code units. A cut document may have
 * lost links, so it is indexed from disk (gap index) instead. UTF-8 bytes >= UTF-16 units
 * for every character, so `octet_length >= cap` catches every cut document (plus a few
 * long non-ASCII ones, which the gap index serves just as well). octet_length on a TOASTed
 * value reads the stored header only; it does not detoast the texts.
 */
export const STORE_TEXT_CAP_CHARS = 4 * 1024 * 1024;

export const STORE_POLL_SQL = `SELECT path, hash, octet_length(text) >= ${STORE_TEXT_CAP_CHARS} AS cut FROM wisdom_docs`;
export const MAP_BATCH_SQL = 'SELECT path, hash, text FROM wisdom_docs WHERE path > $1::text ORDER BY path LIMIT $2::int';
export const FETCH_BY_PATH_SQL = 'SELECT path, hash, text FROM wisdom_docs WHERE path = ANY($1::text[])';

export class QueryTimeoutError extends Error {}

/** A query that ran too long on a store that answers: not an outage. */
function isQueryTimeout(error) {
  return error instanceof QueryTimeoutError
    || error?.code === '57014'
    || /query read timeout/iu.test(error?.message ?? '');
}

/**
 * A fresh, flat copy. Keys are cut out of multi-KB document texts; V8 keeps a sliced or
 * concatenated string pointing at its parent, so storing the key as is would pin the whole
 * document text in the map. ⚠️ Do not drop this copy as an "optimisation".
 */
function flatString(value) {
  return Buffer.from(value, 'utf8').toString('utf8');
}

/** The raw target keys a source's references carry (wiki `x` → `x.md`; images: resolved path). */
export function extractLinkKeys(sourcePath, text) {
  const keys = new Set();
  for (const reference of collectMarkdownReferences(text, { sourceFilePath: sourcePath })) {
    if (reference.rawTargetKey) {
      keys.add(reference.rawTargetKey);
    }
  }
  return Array.from(keys, flatString);
}

/** The keys under which a source referencing targetPath appears in the link-key map. */
export function buildTargetLinkKeys(targetPath, wikiTargetIndex) {
  return [...new Set(collectReferenceTargetKeysForFilePath(targetPath)
    .filter((key) => resolveWikiTargetWithIndex(key, wikiTargetIndex) === targetPath)
    .map((key) => normalizeReferenceTargetKey(key)))];
}

/**
 * Warm-up literals: a source whose reference resolves to targetPath contains one of them.
 * Every resolving wiki reference's raw target is one of the target's own keys (path
 * suffixes, with and without `.md`) that resolve to it under the CURRENT index; a relative
 * markdown image reference contains the image's basename (possibly percent-encoded). A
 * literal that contains another literal is redundant for a substring filter and removed.
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
 * One warm-up page for ONE literal. ⚠️ Never OR several literals into one query: pg_search
 * 0.26 then plans every strpos as a heap filter over the WHOLE store (431 ms vs 20 ms per
 * literal, VERIFICATION G2.c). The BM25 phrase predicate makes it an index scan; strpos
 * keeps only rows that literally contain the literal. A literal without any letter or digit
 * yields no tokens, so a phrase on it would match nothing: then strpos alone decides.
 */
export function buildCandidateQuery(literal, { afterPath = '', limit = CANDIDATE_PAGE_SIZE } = {}) {
  const conditions = [];
  if (/[\p{L}\p{N}]/u.test(literal)) {
    conditions.push('text ### $1::text');
  }
  conditions.push('strpos(text, $1::text) > 0', 'path > $2::text');
  return {
    text: `SELECT path, text FROM wisdom_docs WHERE ${conditions.join(' AND ')} ORDER BY path LIMIT $3::int`,
    values: [literal, afterPath, limit],
  };
}

function withTimeout(promise, timeoutMs, label, { setTimeoutFn, clearTimeoutFn }) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeoutFn(() => reject(new QueryTimeoutError(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    timer?.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeoutFn(timer));
}

export class PgBacklinkProvider {
  constructor({
    clearIntervalFn = clearInterval,
    clearTimeoutFn = clearTimeout,
    logger = console,
    mapBatchPauseMs = 20,
    mapBatchRows = 32,
    now = Date.now,
    overlayMaxMs = 7_200_000,
    overlayWindowMs = 600_000,
    pg,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
    storePollMs = 60_000,
    timeoutMs = 2_000,
    vaultFileStore,
    warmupTimeoutMs = 10_000,
  }) {
    this.requiresStartupBuild = false;
    this.pg = pg;
    this.vaultFileStore = vaultFileStore;
    this.timeoutMs = timeoutMs;
    this.warmupTimeoutMs = warmupTimeoutMs;
    this.overlayWindowMs = overlayWindowMs;
    this.overlayMaxMs = Math.max(overlayMaxMs, overlayWindowMs);
    this.storePollMs = storePollMs;
    this.mapBatchRows = mapBatchRows;
    this.mapBatchPauseMs = mapBatchPauseMs;
    this.logger = logger;
    this.now = now;
    this.timers = { clearIntervalFn, clearTimeoutFn, setIntervalFn, setTimeoutFn };

    this._filePaths = [];
    this._fileSet = new Set();
    this._markdownSet = new Set();
    this._wikiTargetIndex = createWikiTargetIndex([]);
    /** @type {Map<string, { at: number, baseHash: string | null, content: string }>} */
    this._overlay = new Map();
    this._gapSet = new Set();
    this._gapIndex = null;
    this._needsFullGapBuild = true;
    /** @type {Map<string, Set<string>>} normalized raw target key → store source paths */
    this._linkKeys = new Map();
    /** @type {Map<string, { hash: string, keys: string[] }>} store source → what the map holds for it */
    this._mapSources = new Map();
    this._mapReady = false;
    this._mapCursor = '';
    this._mapStartedAt = null;
    this._pollPromise = null;
    this._pollAgain = false;
    this._pollTimer = null;
    this._pgHealthy = true;
    this._closed = false;
  }

  get mapReady() {
    return this._mapReady;
  }

  /** Called once the server listens: adopt the snapshot, then poll the store in the background. */
  start({ workspaceState } = {}) {
    this._setWorkspace(workspaceState);
    if (!this._pollTimer) {
      this._pollTimer = this.timers.setIntervalFn(() => {
        void this.pollStore();
      }, this.storePollMs);
      this._pollTimer?.unref?.();
    }
    return this.pollStore();
  }

  /** Never waits on an in-flight poll: a hanging store must not stall shutdown. */
  async close() {
    this._closed = true;
    if (this._pollTimer) {
      this.timers.clearIntervalFn(this._pollTimer);
      this._pollTimer = null;
    }
    if (this.pg?.end) {
      await withTimeout(Promise.resolve().then(() => this.pg.end()), CLOSE_TIMEOUT_MS, 'Postgres pool close', this.timers)
        .catch((error) => this.logger.warn(`[backlinks] ${error.message}`));
    }
  }

  /** No full-vault build exists in this mode (the test reset endpoint calls this). */
  async build() {}

  /** The ">25 paths changed" path: adopt the new snapshot and rebuild the gap index from it. */
  scheduleBuild({ workspaceState } = {}) {
    if (workspaceState) {
      this._setWorkspace(workspaceState);
    }
    this._needsFullGapBuild = true;
    return this.pollStore();
  }

  updateFile(filePath, content, { refreshIndex = true } = {}) {
    if (!this._fileSet.has(filePath)) {
      this._fileSet.add(filePath);
      this._filePaths.push(filePath);
      if (refreshIndex) {
        this._wikiTargetIndex = createWikiTargetIndex(this._filePaths);
        this._gapIndex?.refreshTargetIndex();
      }
    }

    if (!isMarkdownFilePath(filePath)) {
      return;
    }

    this._markdownSet.add(filePath);
    this._setOverlay(filePath, content);
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
        this._setOverlay(pathValue, content);
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

    if (this._pollPromise) {
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

    const timeoutMs = this._mapReady ? this.timeoutMs : this.warmupTimeoutMs;
    try {
      if (this._mapReady) {
        await this._collectFromLinkMap(targetPath, bySource, timeoutMs);
      } else {
        await this._collectFromPhraseQuery(targetPath, bySource, timeoutMs);
      }
      if (!this._pgHealthy) {
        // Back after an outage: bring the gap set and the link map up to date now, not at the next poll.
        this._markPostgresHealthy();
        void this.pollStore();
      }
    } catch (error) {
      if (isQueryTimeout(error)) {
        this.logger.warn(`[backlinks] ${targetPath}: Postgres part cut short after ${timeoutMs} ms (${this._mapReady ? 'link map' : 'warm-up'}); returning partial results`);
      } else {
        this._markPostgresFailed(error);
      }
    }

    const results = [];
    for (const [file, contexts] of bySource) {
      results.push({ file, contexts });
    }
    results.sort((a, b) => a.file.localeCompare(b.file));
    return results;
  }

  /** Poll the store: gap set, cut docs, link-key map (build or refresh). Never rejects. */
  pollStore() {
    if (this._pollPromise) {
      this._pollAgain = true;
      return this._pollPromise;
    }

    this._pollPromise = (async () => {
      do {
        this._pollAgain = false;
        await this._pollStoreOnce();
      } while (this._pollAgain && !this._closed);
    })().finally(() => {
      this._pollPromise = null;
    });
    return this._pollPromise;
  }

  // --- Private methods ---

  _setWorkspace(workspaceState) {
    // Same derivation as BacklinkIndex._performBuild, so both resolve against the same list in the same order.
    const filePaths = Array.from(workspaceState?.filePaths ?? workspaceState?.markdownPaths ?? []);
    const unchanged = filePaths.length === this._filePaths.length
      && filePaths.every((filePath, index) => filePath === this._filePaths[index]);
    // Every watched save lands here; rebuilding the wiki index (47 MB at main scale) for an
    // unchanged file list would be pure churn.
    if (!unchanged) {
      this._filePaths = filePaths;
      this._fileSet = new Set(filePaths);
      this._wikiTargetIndex = createWikiTargetIndex(filePaths);
      this._gapIndex?.refreshTargetIndex();
    }
    this._markdownSet = new Set(Array.from(
      workspaceState?.markdownPaths ?? filePaths.filter((filePath) => isMarkdownFilePath(filePath)),
    ).filter((filePath) => this._fileSet.has(filePath)));
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

  _isStoreCandidate(sourcePath, bySource) {
    return !bySource.has(sourcePath)
      && !this._overlay.has(sourcePath)
      && !this._gapSet.has(sourcePath)
      && this._markdownSet.has(sourcePath);
  }

  _confirmRow(row, targetPath, bySource) {
    if (!this._isStoreCandidate(row.path, bySource)) {
      return;
    }
    const contexts = this._contextsFor(row.path, row.text ?? '', targetPath);
    if (contexts.length > 0) {
      bySource.set(row.path, contexts);
    }
  }

  /** Map path: exact candidates, then their current store text, then the confirm step. */
  async _collectFromLinkMap(targetPath, bySource, timeoutMs) {
    if (!this.pg || !this._wikiTargetIndex.exactPaths.has(targetPath)) {
      return;
    }
    const candidates = new Set();
    for (const key of buildTargetLinkKeys(targetPath, this._wikiTargetIndex)) {
      this._linkKeys.get(key)?.forEach((sourcePath) => {
        if (this._isStoreCandidate(sourcePath, bySource)) {
          candidates.add(sourcePath);
        }
      });
    }

    const deadline = this.now() + timeoutMs;
    const paths = Array.from(candidates);
    for (let index = 0; index < paths.length; index += FETCH_CHUNK_SIZE) {
      const remainingMs = Math.max(1, deadline - this.now());
      const { rows } = await this._query({
        text: FETCH_BY_PATH_SQL,
        values: [paths.slice(index, index + FETCH_CHUNK_SIZE)],
      }, remainingMs, 'backlink source fetch');
      rows.forEach((row) => this._confirmRow(row, targetPath, bySource));
    }
  }

  /** Warm-up path: one BM25 phrase + strpos query per literal, keyset-paged to the end. */
  async _collectFromPhraseQuery(targetPath, bySource, timeoutMs) {
    if (!this.pg || !this._wikiTargetIndex.exactPaths.has(targetPath)) {
      return;
    }
    const deadline = this.now() + timeoutMs;
    for (const literal of buildCandidateLiterals(targetPath, this._wikiTargetIndex)) {
      let afterPath = '';
      for (;;) {
        const remainingMs = Math.max(1, deadline - this.now());
        const { rows } = await this._query(
          buildCandidateQuery(literal, { afterPath, limit: CANDIDATE_PAGE_SIZE }),
          remainingMs,
          'backlink candidate query',
        );
        rows.forEach((row) => this._confirmRow(row, targetPath, bySource));
        if (rows.length < CANDIDATE_PAGE_SIZE) {
          break;
        }
        afterPath = rows[rows.length - 1].path;
      }
    }
  }

  _query(queryConfig, timeoutMs, label) {
    return withTimeout(Promise.resolve().then(() => this.pg.query(queryConfig, { timeoutMs })), timeoutMs, label, this.timers);
  }

  _backgroundQuery(queryConfig, label) {
    return this._query(queryConfig, BACKGROUND_QUERY_TIMEOUT_MS, label);
  }

  async _pollStoreOnce() {
    let rows;
    try {
      ({ rows } = await this._backgroundQuery({ text: STORE_POLL_SQL }, 'backlink store poll'));
      this._markPostgresHealthy();
    } catch (error) {
      if (isQueryTimeout(error)) {
        this.logger.warn(`[backlinks] store poll: ${error.message}`);
      } else {
        this._markPostgresFailed(error);
      }
      return;
    }
    if (this._closed) {
      return;
    }

    const storeRows = new Map();
    rows.forEach((row) => storeRows.set(row.path, row));
    await Promise.all([
      this._refreshGapIndex(storeRows),
      this._refreshLinkMap(storeRows),
    ]);
    this._pruneOverlay();
  }

  async _refreshGapIndex(storeRows) {
    try {
      const markdownPaths = Array.from(this._markdownSet);
      const nextGap = new Set(markdownPaths.filter((filePath) => !storeRows.has(filePath) || storeRows.get(filePath).cut));
      const overlap = markdownPaths.length - nextGap.size;
      this.logger.log(`[backlinks] gap refresh: ${markdownPaths.length} markdown sources, ${storeRows.size} store rows, ${overlap} in both, ${nextGap.size} gap`);
      if (overlap === 0 && markdownPaths.length > 0) {
        this.logger.warn('[backlinks] no workspace markdown path is present in wisdom_docs; check that the store holds vault-relative paths');
      }

      if (!this._gapIndex || this._needsFullGapBuild) {
        this._needsFullGapBuild = false;
        // ⚠️ The gap index resolves with THIS provider's wiki index (one 47 MB copy at main scale, not
        // two), in the canonical snapshot order the Postgres part uses.
        const gapIndex = new BacklinkIndex({
          createTargetIndex: () => this._wikiTargetIndex,
          vaultFileStore: this.vaultFileStore,
        });
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
    } catch (error) {
      this.logger.warn(`[backlinks] gap index refresh failed: ${error.message}`);
    }
  }

  async _refreshLinkMap(storeRows) {
    try {
      if (!this._mapReady) {
        await this._streamLinkMap();
        return;
      }

      for (const sourcePath of this._mapSources.keys()) {
        const row = storeRows.get(sourcePath);
        if (!row || row.cut) {
          this._setMapSource(sourcePath, null);
        }
      }
      const changed = [];
      storeRows.forEach((row, sourcePath) => {
        if (!row.cut && this._mapSources.get(sourcePath)?.hash !== row.hash) {
          changed.push(sourcePath);
        }
      });
      for (let index = 0; index < changed.length && !this._closed; index += this.mapBatchRows) {
        const { rows } = await this._backgroundQuery({
          text: FETCH_BY_PATH_SQL,
          values: [changed.slice(index, index + this.mapBatchRows)],
        }, 'backlink link-map refresh');
        rows.forEach((row) => this._indexStoreRow(row));
        await this._pause();
      }
      if (changed.length > 0) {
        this.logger.log(`[backlinks] link map refresh: ${changed.length} changed store rows`);
      }
    } catch (error) {
      if (isQueryTimeout(error)) {
        this.logger.warn(`[backlinks] link map: ${error.message}; resuming at the next poll`);
      } else {
        this._markPostgresFailed(error);
      }
    }
  }

  /** The first full read of the store, resumable from `_mapCursor` after a failure. */
  async _streamLinkMap() {
    this._mapStartedAt ??= this.now();
    for (;;) {
      if (this._closed) {
        return;
      }
      const { rows } = await this._backgroundQuery({
        text: MAP_BATCH_SQL,
        values: [this._mapCursor, this.mapBatchRows],
      }, 'backlink link-map build');
      rows.forEach((row) => this._indexStoreRow(row));
      if (rows.length > 0) {
        this._mapCursor = rows[rows.length - 1].path;
      }
      if (rows.length < this.mapBatchRows) {
        break;
      }
      await this._pause();
    }

    this._mapReady = true;
    let links = 0;
    this._linkKeys.forEach((sources) => {
      links += sources.size;
    });
    this.logger.log(`[backlinks] link map ready: ${this._mapSources.size} store sources, ${this._linkKeys.size} keys, ${links} links, ${Math.round((this.now() - this._mapStartedAt) / 100) / 10} s`);
  }

  _indexStoreRow(row) {
    // A cut document's text may have lost links; the gap index reads it from disk instead.
    const cut = (row.text?.length ?? 0) >= STORE_TEXT_CAP_CHARS;
    this._setMapSource(row.path, cut ? null : { hash: row.hash, keys: extractLinkKeys(row.path, row.text ?? '') });
  }

  _setMapSource(sourcePath, entry) {
    const previous = this._mapSources.get(sourcePath);
    previous?.keys.forEach((key) => {
      const sources = this._linkKeys.get(key);
      sources?.delete(sourcePath);
      if (sources?.size === 0) {
        this._linkKeys.delete(key);
      }
    });
    if (!entry) {
      this._mapSources.delete(sourcePath);
      return;
    }

    this._mapSources.set(sourcePath, entry);
    entry.keys.forEach((key) => {
      let sources = this._linkKeys.get(key);
      if (!sources) {
        sources = new Set();
        this._linkKeys.set(key, sources);
      }
      sources.add(sourcePath);
    });
  }

  _pause() {
    if (this.mapBatchPauseMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.timers.setTimeoutFn(resolve, this.mapBatchPauseMs);
    });
  }

  _setOverlay(filePath, content) {
    this._overlay.set(filePath, {
      at: this.now(),
      // The store's hash for this path when the edit happened (null: not known yet).
      baseHash: this._mapReady ? (this._mapSources.get(filePath)?.hash ?? null) : null,
      content,
    });
  }

  /**
   * An overlay entry outlives the window until the store has caught up with that path: its
   * polled hash changed since the edit (the store re-read the file after it). Agent scratch is
   * reindexed only on the store's full walk (30 min) and a store-writer outage stops all
   * reindexing, so dropping at the window alone would hide a link the file still holds.
   * Bounded by overlayMaxMs. Gap files drop at the window: the gap index holds their disk content.
   */
  _pruneOverlay() {
    const now = this.now();
    for (const [filePath, entry] of this._overlay) {
      const age = now - entry.at;
      if (!this._markdownSet.has(filePath) || age >= this.overlayMaxMs) {
        this._overlay.delete(filePath);
        continue;
      }
      if (age < this.overlayWindowMs) {
        continue;
      }
      if (this._gapSet.has(filePath) || this._storeCaughtUp(filePath, entry)) {
        this._overlay.delete(filePath);
      }
    }
  }

  _storeCaughtUp(filePath, entry) {
    const current = this._mapReady ? (this._mapSources.get(filePath)?.hash ?? null) : null;
    if (current === null) {
      return false;
    }
    if (entry.baseHash === null) {
      // Edited before the store's hash was known: wait for a change from the first one seen.
      entry.baseHash = current;
      return false;
    }
    return current !== entry.baseHash;
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

/**
 * A lazily created `pg` Pool (the dependency is loaded on the first query, never at startup),
 * shared by panel requests and the background stream: at most `max` (2) connections in total,
 * under the role's connection limit of 3.
 *
 * Every query carries its own server-side `statement_timeout` = the time left to its caller,
 * so a query that outlives its request is cancelled BY THE SERVER (lock waits included) and
 * its backend is freed; the client waits CANCEL_GRACE_MS longer so the cancel lands first and
 * the connection stays reusable. A checkout that misses its deadline is handed back unused.
 * ⚠️ Do not replace this with the client-side `query_timeout` alone: it abandons the client
 * while the statement keeps a backend busy up to the role's statement timeout, and backends
 * pile up with every slow panel open (VERIFICATION G4.f1).
 */
export function createPgDocsClient({
  createPool = null,
  database,
  host,
  password,
  port = 5432,
  sslmode = 'require',
  user,
}) {
  let poolPromise = null;
  const getPool = () => {
    poolPromise ??= (createPool ? Promise.resolve(createPool()) : import('pg').then(({ default: pg }) => new pg.Pool({
      application_name: 'collabmd-backlinks',
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      database,
      host,
      idleTimeoutMillis: 30_000,
      max: 2,
      password,
      port,
      ssl: sslmode === 'disable' ? false : { rejectUnauthorized: sslmode === 'verify-full' },
      user,
    }))).then((pool) => {
      // An idle client's error is emitted on the pool; unhandled it would crash the process.
      pool.on?.('error', (error) => {
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
    async query(queryConfig, { timeoutMs = BACKGROUND_QUERY_TIMEOUT_MS } = {}) {
      const deadline = Date.now() + timeoutMs;
      const pool = await getPool();
      const checkout = pool.connect();
      let timer = null;
      const client = await Promise.race([
        checkout,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
          timer.unref?.();
        }),
      ]).finally(() => clearTimeout(timer));
      if (!client) {
        // Hand the connection back the moment the pool produces it; never run a late query on it.
        checkout.then((late) => late.release(), () => {});
        throw new QueryTimeoutError(`no Postgres connection free within ${timeoutMs} ms`);
      }

      let failure;
      try {
        const remainingMs = Math.ceil(deadline - Date.now());
        if (remainingMs <= 0) {
          throw new QueryTimeoutError(`no time left after waiting ${timeoutMs} ms for a connection`);
        }
        await client.query(`SET statement_timeout = ${remainingMs}`);
        return await client.query({ ...queryConfig, query_timeout: remainingMs + CANCEL_GRACE_MS });
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        // A server-side cancel (57014) leaves the connection healthy; anything else discards it.
        client.release(failure && failure.code !== '57014' && !(failure instanceof QueryTimeoutError) ? failure : undefined);
      }
    },
  };
}
