import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getVaultFileKind } from '../../domain/file-kind.js';
import { logPerfEvent } from '../config/perf-logging.js';

// The FTS engine base URL is CONSTANT — no request-derived value ever reaches the
// host/port/path (no SSRF surface). Overridable only via a server-side env var for
// local development pointing at a different engine.
const DEFAULT_ENGINE_URL = process.env.COLLABMD_WISDOM_ENGINE_URL
  || 'http://wisdom-apps.wisdom:8181/query';
const ENGINE_COLLECTION = 'brain';
const ENGINE_PATH_PREFIX = 'brain/';

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_SNIPPETS_PER_FILE = 5;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 512;
const SNIPPET_CONTEXT_CHARS = 90;
const LEX_TIMEOUT_MS = 4_000;
// vec end-to-end (embedding + rerank + expansion round-trips) measures ~16–20 s and
// spikes past 20 s under load; 25 s tolerates the observed variance while still bounding
// the hang. The progressive lex preview means the user is never staring at a blank wait.
const FULL_TIMEOUT_MS = 25_000;

// --- pure helpers (copied from ripgrep-search-service to keep that file byte-identical
//     for clean upstream merges — the two functions are small, pure, and independently
//     unit-tested here). ---

export function byteOffsetToStringIndex(value = '', byteOffset = 0) {
  const normalizedOffset = Math.max(0, Number(byteOffset) || 0);
  if (normalizedOffset === 0) {
    return 0;
  }

  const text = String(value ?? '');
  let byteCount = 0;
  let stringIndex = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (byteCount + charBytes > normalizedOffset) {
      return stringIndex;
    }
    byteCount += charBytes;
    stringIndex += char.length;
  }

  return text.length;
}

export function createSnippet(lineText = '', matchStart = 0, matchEnd = matchStart) {
  const normalizedLine = String(lineText ?? '').replace(/\r?\n$/u, '');
  const safeStart = Math.min(Math.max(Math.round(matchStart), 0), normalizedLine.length);
  const safeEnd = Math.min(Math.max(Math.round(matchEnd), safeStart), normalizedLine.length);
  const snippetStart = Math.max(0, safeStart - SNIPPET_CONTEXT_CHARS);
  const snippetEnd = Math.min(normalizedLine.length, safeEnd + SNIPPET_CONTEXT_CHARS);
  const prefix = snippetStart > 0 ? '...' : '';
  const suffix = snippetEnd < normalizedLine.length ? '...' : '';
  const text = `${prefix}${normalizedLine.slice(snippetStart, snippetEnd)}${suffix}`;
  const prefixLength = prefix.length;

  return {
    matchEnd: prefixLength + (safeEnd - snippetStart),
    matchStart: prefixLength + (safeStart - snippetStart),
    text,
  };
}

// --- slug mapping (THE make-or-break, conception §2) ---

/**
 * Apply the QMD indexer's forward slug rule to a real vault path so it matches the
 * engine's lossy `file` field. Per segment: every run of non-[A-Za-z0-9] → a single
 * `-`, trimmed; `/` separators and the final extension are preserved; case is kept.
 */
export function slugifyEnginePath(vaultPath) {
  const raw = String(vaultPath ?? '').replace(/^\/+/, '');
  if (!raw) {
    return '';
  }

  const lastSlash = raw.lastIndexOf('/');
  const dir = lastSlash >= 0 ? raw.slice(0, lastSlash) : '';
  const base = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;
  const dotIndex = base.lastIndexOf('.');
  const stem = dotIndex > 0 ? base.slice(0, dotIndex) : base;
  const ext = dotIndex > 0 ? base.slice(dotIndex) : '';

  const slugSegment = (segment) => String(segment)
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  const dirSlug = dir
    ? dir.split('/').map(slugSegment).join('/')
    : '';
  const baseSlug = `${slugSegment(stem)}${ext}`;

  return dirSlug ? `${dirSlug}/${baseSlug}` : baseSlug;
}

/**
 * Build Map<slug, realVaultPath[]> for every markdown vault path. Multiple real paths
 * that slug to the same key form a collision list (rare); resolution disambiguates by
 * content later.
 */
export function buildSlugMap(filePaths = []) {
  const map = new Map();
  for (const filePath of filePaths) {
    const normalized = String(filePath ?? '');
    if (!/\.(md|markdown|mdx)$/iu.test(normalized)) {
      continue;
    }
    const slug = slugifyEnginePath(normalized);
    if (!slug) {
      continue;
    }
    const existing = map.get(slug);
    if (existing) {
      existing.push(normalized);
    } else {
      map.set(slug, [normalized]);
    }
  }
  return map;
}

// --- engine snippet parsing ---

/**
 * The engine `snippet` is a numbered/hunk blob, e.g.
 *   "82: @@ -81,3 @@ (80 before, 0 after)\n83: - [[Kagent]] ...\n84: ..."
 * The leading `<n>: ` numbers are display-relative and NOT real file lines. Strip the
 * numeric prefix, drop `@@` hunk-header lines, and return the content lines' text.
 */
export function parseEngineSnippetLines(snippet = '') {
  const lines = String(snippet ?? '').split(/\r?\n/u);
  const contentLines = [];
  for (const rawLine of lines) {
    const withoutNumber = rawLine.replace(/^\s*\d+:\s?/u, '');
    if (/^@@\s/u.test(withoutNumber.trim())) {
      continue;
    }
    contentLines.push(withoutNumber);
  }
  return contentLines;
}

function normalizeQueryTerms(query = '') {
  return String(query ?? '')
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => term.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((term) => term.length >= 2)
    .sort((left, right) => right.length - left.length);
}

/** Find the offset of the first query term present in `lineText` (case-insensitive). */
function findMatchOffset(lineText = '', queryTerms = []) {
  const lower = String(lineText ?? '').toLowerCase();
  for (const term of queryTerms) {
    const index = lower.indexOf(term);
    if (index >= 0) {
      return { end: index + term.length, start: index };
    }
  }
  return null;
}

/**
 * Locate a representative content line inside the resolved real file and emit a true
 * {line, column, text, matchStart, matchEnd}. Falls back to line:null (open at top, no
 * highlight) for pure semantic hits with no literal term on any content line.
 */
export function locateSnippetInFile(fileContent = '', contentLines = [], queryTerms = []) {
  const fileLines = String(fileContent ?? '').split(/\r?\n/u);

  // Prefer a content line that both exists in the file AND contains a query term.
  const candidates = contentLines
    .map((text) => text.replace(/\s+$/u, ''))
    .filter((text) => text.trim().length > 0);

  let best = null;
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const lineIndex = fileLines.findIndex((fileLine) => fileLine.trim() === trimmed);
    if (lineIndex < 0) {
      continue;
    }
    const fileLine = fileLines[lineIndex];
    const offset = findMatchOffset(fileLine, queryTerms);
    if (offset) {
      const snippet = createSnippet(fileLine, offset.start, offset.end);
      return {
        column: snippet.matchStart + 1,
        line: lineIndex + 1,
        matchEnd: snippet.matchEnd,
        matchStart: snippet.matchStart,
        text: snippet.text,
      };
    }
    if (!best) {
      const snippet = createSnippet(fileLine, 0, 0);
      best = {
        column: 1,
        line: lineIndex + 1,
        matchEnd: 0,
        matchStart: 0,
        text: snippet.text,
      };
    }
  }

  if (best) {
    return best;
  }

  // Semantic-only: no literal line located. Show the first content line, open at top.
  const fallbackText = candidates[0] ?? '';
  const snippet = createSnippet(fallbackText, 0, 0);
  return {
    column: 1,
    line: null,
    matchEnd: 0,
    matchStart: 0,
    text: snippet.text,
  };
}

function createEmptyResult({ query = '', searchConfig, truncated = false } = {}) {
  return {
    backend: 'wisdom',
    files: [],
    matchCount: 0,
    ok: true,
    query,
    search: searchConfig,
    truncated,
  };
}

function buildEngineSearches(mode) {
  // `full` is authoritative (semantic + keyword, server-merged & ranked); `lex` is the
  // fast keyword-only preview (progressive Call A). Default to `full`.
  if (mode === 'lex') {
    return [{ type: 'lex' }];
  }
  return [{ type: 'vec' }, { type: 'lex' }];
}

export class WisdomSearchService {
  constructor({
    engineUrl = DEFAULT_ENGINE_URL,
    fetchImpl = globalThis.fetch,
    getVaultFilePaths = () => [],
    maxFiles = DEFAULT_MAX_FILES,
    maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
    perfLoggingEnabled = false,
    vaultDir,
  } = {}) {
    this.engineUrl = engineUrl;
    this.fetchImpl = fetchImpl;
    this.getVaultFilePaths = getVaultFilePaths;
    this.maxFiles = maxFiles;
    this.maxSnippetsPerFile = maxSnippetsPerFile;
    this.perfLoggingEnabled = perfLoggingEnabled;
    this.vaultDir = vaultDir;

    // Optimistic: assume the in-pod engine is reachable. No startup network probe — real
    // availability is settled per request in search(), which degrades gracefully on any
    // engine error/timeout (FDE state ⑤). This keeps startup side-effect-free and lets a
    // slow-to-start engine recover without a server restart.
    this.available = true;
    this.unavailableReason = '';
    this._slugMap = null;
    this._slugMapSourceRef = null;
  }

  async initialize() {
    logPerfEvent(this.perfLoggingEnabled, 'wisdom-search-capability', {
      available: this.available,
      backend: 'wisdom',
    });

    return this.getClientConfig();
  }

  getClientConfig() {
    return {
      available: this.available,
      backend: 'wisdom',
      minQueryLength: MIN_QUERY_LENGTH,
      unavailableReason: this.unavailableReason,
      version: 'wisdom-fts',
    };
  }

  _ensureSlugMap() {
    const filePaths = this.getVaultFilePaths?.() ?? [];
    // The workspace snapshot is replaced (new array reference) on every file-watch
    // mutation, so reference identity is a correct + cheap invalidation signal — no new
    // FS walk, no event wiring.
    if (this._slugMap && filePaths === this._slugMapSourceRef) {
      return this._slugMap;
    }
    this._slugMap = buildSlugMap(filePaths);
    this._slugMapSourceRef = filePaths;
    return this._slugMap;
  }

  async _callEngine({ mode, query, timeoutMs }) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch is unavailable in this runtime');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(this.engineUrl, {
        body: JSON.stringify({
          collections: [ENGINE_COLLECTION],
          limit: this.maxFiles,
          searches: buildEngineSearches(mode).map((search) => ({
            ...search,
            query: String(query ?? ''),
          })),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`engine responded ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async _resolveHit(enginePath, contentLines, queryTerms, slugMap) {
    const slug = String(enginePath ?? '').startsWith(ENGINE_PATH_PREFIX)
      ? String(enginePath).slice(ENGINE_PATH_PREFIX.length)
      : String(enginePath ?? '');
    const candidates = slugMap.get(slug);

    if (!candidates || candidates.length === 0) {
      return { realPath: null, slug, unresolvable: true };
    }

    if (candidates.length === 1) {
      const realPath = candidates[0];
      const snippet = await this._buildSnippet(realPath, contentLines, queryTerms);
      return { realPath, snippet, unresolvable: false };
    }

    // Collision: pick the candidate whose content contains a representative snippet line.
    for (const candidate of candidates) {
      const content = await this._readVaultFile(candidate);
      if (content === null) {
        continue;
      }
      const hasLine = contentLines.some((text) => {
        const trimmed = text.trim();
        return trimmed.length > 0 && content.includes(trimmed);
      });
      if (hasLine) {
        return {
          realPath: candidate,
          snippet: locateSnippetInFile(content, contentLines, queryTerms),
          unresolvable: false,
        };
      }
    }

    // Ambiguous — fall back to the first candidate and log.
    console.warn(`[wisdom-search] slug collision for "${slug}" — using ${candidates[0]}`);
    const fallback = candidates[0];
    const snippet = await this._buildSnippet(fallback, contentLines, queryTerms);
    return { realPath: fallback, snippet, unresolvable: false };
  }

  async _buildSnippet(realPath, contentLines, queryTerms) {
    const content = await this._readVaultFile(realPath);
    if (content === null) {
      const fallback = createSnippet(contentLines.find((text) => text.trim()) ?? '', 0, 0);
      return { column: 1, line: null, matchEnd: 0, matchStart: 0, text: fallback.text };
    }
    return locateSnippetInFile(content, contentLines, queryTerms);
  }

  async _readVaultFile(relativePath) {
    if (!this.vaultDir) {
      return null;
    }
    try {
      return await readFile(join(this.vaultDir, relativePath), 'utf8');
    } catch {
      return null;
    }
  }

  async _transformResults(engineResponse, { query, limit }) {
    const results = Array.isArray(engineResponse?.results) ? engineResponse.results : [];
    const slugMap = this._ensureSlugMap();
    const queryTerms = normalizeQueryTerms(query);

    const files = [];
    const filesByPath = new Map();
    let matchCount = 0;
    let truncated = false;

    for (const result of results) {
      const enginePath = String(result?.file ?? '');
      if (!enginePath) {
        continue;
      }
      const contentLines = parseEngineSnippetLines(result?.snippet ?? '');
      const resolved = await this._resolveHit(enginePath, contentLines, queryTerms, slugMap);

      if (resolved.unresolvable) {
        if (files.length >= limit) {
          truncated = true;
          continue;
        }
        const displayText = createSnippet(contentLines.find((text) => text.trim()) ?? '', 0, 0);
        const displayPath = resolved.slug || enginePath;
        files.push({
          file: displayPath,
          kind: 'text',
          matchCount: 1,
          snippets: [{ column: 1, line: null, matchEnd: 0, matchStart: 0, text: displayText.text }],
          unresolvable: true,
        });
        matchCount += 1;
        continue;
      }

      let fileGroup = filesByPath.get(resolved.realPath);
      if (!fileGroup) {
        if (files.length >= limit) {
          truncated = true;
          continue;
        }
        fileGroup = {
          file: resolved.realPath,
          kind: getVaultFileKind(resolved.realPath) ?? 'text',
          matchCount: 0,
          snippets: [],
        };
        filesByPath.set(resolved.realPath, fileGroup);
        files.push(fileGroup);
      }

      if (fileGroup.snippets.length >= this.maxSnippetsPerFile) {
        truncated = true;
        continue;
      }
      fileGroup.snippets.push(resolved.snippet);
      fileGroup.matchCount += 1;
      matchCount += 1;
    }

    return {
      backend: 'wisdom',
      files,
      matchCount,
      ok: true,
      query,
      search: this.getClientConfig(),
      truncated,
    };
  }

  async search({ limit = DEFAULT_MAX_FILES, mode = 'full', query = '' } = {}) {
    const normalizedQuery = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
    const normalizedMode = mode === 'lex' ? 'lex' : 'full';
    const maxFiles = Math.min(
      Math.max(Number.parseInt(limit, 10) || this.maxFiles, 1),
      this.maxFiles,
    );

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      return createEmptyResult({ query: normalizedQuery, searchConfig: this.getClientConfig() });
    }

    const startedAt = Date.now();
    const timeoutMs = normalizedMode === 'lex' ? LEX_TIMEOUT_MS : FULL_TIMEOUT_MS;

    try {
      const engineResponse = await this._callEngine({
        mode: normalizedMode,
        query: normalizedQuery,
        timeoutMs,
      });
      this.available = true;
      this.unavailableReason = '';
      const transformed = await this._transformResults(engineResponse, {
        limit: maxFiles,
        query: normalizedQuery,
      });
      logPerfEvent(this.perfLoggingEnabled, 'wisdom-search-query', {
        durationMs: Date.now() - startedAt,
        fileCount: transformed.files.length,
        matchCount: transformed.matchCount,
        mode: normalizedMode,
        truncated: transformed.truncated,
      });
      return transformed;
    } catch (error) {
      this.available = false;
      const timedOut = error?.name === 'AbortError';
      this.unavailableReason = timedOut
        ? 'The wisdom search engine took too long to respond.'
        : 'The wisdom search engine is not responding.';
      logPerfEvent(this.perfLoggingEnabled, 'wisdom-search-query', {
        durationMs: Date.now() - startedAt,
        error: timedOut ? 'timeout' : 'unavailable',
        mode: normalizedMode,
      });
      // NEVER leak the raw engine error/stack to the client — always a plain-English
      // message + the unavailable search config (mirrors ripgrep's degrade convention).
      const wrapped = new Error(this.unavailableReason);
      wrapped.statusCode = timedOut ? 504 : 503;
      wrapped.search = this.getClientConfig();
      throw wrapped;
    }
  }
}
