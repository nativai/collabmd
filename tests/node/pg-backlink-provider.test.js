import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { BacklinkIndex } from '../../src/server/domain/backlink-index.js';
import {
  FETCH_BY_PATH_SQL,
  MAP_BATCH_SQL,
  PgBacklinkProvider,
  STORE_POLL_SQL,
  STORE_TEXT_CAP_CHARS,
  buildCandidateLiterals,
  buildCandidateQuery,
  buildTargetLinkKeys,
  createPgDocsClient,
  extractLinkKeys,
} from '../../src/server/domain/pg-backlink-provider.js';
import { createWikiTargetIndex } from '../../src/domain/wiki-link-resolver.js';
import { loadBacklinksConfig, loadConfig } from '../../src/server/config/env.js';
import { createAppServer } from '../../src/server/create-app-server.js';

// A synthetic vault. Every case the Backlinks panel must get right sits in it; the parity
// test below compares both implementations on EVERY file of it.
const FIXTURE = [
  ['assets/diagram.excalidraw', '{}'],
  ['assets/img.png', 'PNG'],
  ['assets/my pic.png', 'PNG'],
  ['assets/Pasted image 20260125155427.png', 'PNG'],
  ['a/dup.md', '# dup in a'],
  ['b/dup.md', '# dup in b'],
  ['notes/target.md', '# Target'],
  ['notes/target.png', 'PNG'],
  ['other/target-notes.md', '# a different file whose name starts with target'],
  ['x.md', '# x'],
  ['sources/alias.md', 'Alias [[target|the target]] and heading [[target#Section]].'],
  ['sources/plain.md', 'Plain [[target]].\nTwice on one line [[target]] and [[target]].'],
  ['sources/qualified.md', 'Qualified [[notes/target]] and with extension [[notes/target.md]].'],
  ['sources/embeds.md', 'Embed ![[img.png]] and ![[diagram.excalidraw]] and ![[target]].'],
  ['sources/relative.md', 'Relative image ![pic](../assets/img.png) and encoded ![p](../assets/my%20pic.png).'],
  // An image whose name encodeURIComponent changes: two warm-up literals (VERIFICATION G2.c).
  ['sources/pasted.md', 'Relative ![p](../assets/Pasted%20image%2020260125155427.png) and embed ![[Pasted image 20260125155427.png]].'],
  ['assets/local.md', 'Local relative image ![x](img.png).'],
  // Negative cases (must NOT be backlinks of notes/target.md):
  ['negatives/mention.md', 'A plain-text mention of target and notes/target.md without any link.'],
  ['negatives/other-stem.md', 'Links [[target-notes]] and [[target.png]] — same stem, different files.'],
  ['negatives/dup-elsewhere.md', 'Ambiguous [[dup]] resolves to a/dup.md, never to b/dup.md.'],
  ['negatives/md-link.md', 'A relative markdown link [x](../x.md) is not a backlink in either mode.'],
  ['negatives/missing.md', 'A link to [[nowhere]] resolves to nothing.'],
  ['notes/self.md', 'Self link [[self]] does not count.'],
  // Parity cases where today's index DOES count a link (and so must the provider):
  ['parity/fence.md', 'Before\n```\n[[target]] inside a code fence\n```\nAfter'],
  ['parity/dup-b.md', 'Qualified [[b/dup]] reaches b/dup.md.'],
  // Names that stress the store's tokenizer (hyphen, non-ASCII, underscore, CJK, padding):
  ['names/C-EFFORT.md', '# c'],
  ['names/Über Notiz.md', '# u'],
  ['names/snake_case_note.md', '# s'],
  ['names/日本語ノート.md', '# j'],
  ['sources/names.md', 'See [[C-EFFORT]], [[Über Notiz]], [[snake_case_note]], [[日本語ノート]] and [[ C-EFFORT ]].'],
  ['negatives/case.md', 'The resolver is case-sensitive: [[c-effort]] is not names/C-EFFORT.md.'],
];

const MODES = ['link map', 'warm-up'];

/** The store's `text` column: a line of the path's words, then the body (see the provider). */
function storeText(path, body) {
  return `${path.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ')}\n${body}`;
}

class StubVaultStore {
  constructor(files) {
    this.files = new Map(files);
    this.reads = [];
  }

  async scanWorkspaceState() {
    const filePaths = [...this.files.keys()].sort((left, right) => left.localeCompare(right));
    return { filePaths, markdownPaths: filePaths.filter((pathValue) => pathValue.endsWith('.md')) };
  }

  async readMarkdownFile(path) {
    this.reads.push(path);
    return this.files.get(path) ?? null;
  }
}

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Evaluates the provider's queries against an in-memory doc table with the semantics of the
 * SQL. The warm-up query keeps rows containing its ONE literal (strpos), path > $after,
 * ordered by path, limited; its BM25 phrase predicate is a superset filter checked against
 * real pg_search separately.
 */
class FakeDocsStore {
  constructor(docs, { cutPaths = [] } = {}) {
    this.docs = new Map(docs);
    this.cutPaths = new Set(cutPaths);
    this.queries = [];
    this.fetchedPaths = [];
    this.failWith = null;
    this.failMapBatchesOnce = 0;
    this.hang = false;
    this.holdMap = false;
    this.hangFetch = false;
    this.candidateDelayMs = 0;
  }

  async query({ text, values = [] }) {
    this.queries.push({ text, values });
    if (this.hang) {
      return new Promise(() => {});
    }
    if (this.failWith) {
      throw this.failWith;
    }
    const sorted = () => [...this.docs.entries()].sort(([left], [right]) => compare(left, right));
    const row = ([path, docText]) => ({ hash: createHash('md5').update(docText).digest('hex'), path, text: docText });
    if (text === STORE_POLL_SQL) {
      return { rows: sorted().map((entry) => ({ cut: this.cutPaths.has(entry[0]), hash: row(entry).hash, path: entry[0] })) };
    }
    if (text === MAP_BATCH_SQL) {
      if (this.holdMap) {
        return new Promise(() => {});
      }
      if (this.failMapBatchesOnce > 0 && this.queries.filter((query) => query.text === MAP_BATCH_SQL).length > 1) {
        this.failMapBatchesOnce -= 1;
        throw new Error('connect ECONNRESET');
      }
      const [afterPath, limit] = values;
      return { rows: sorted().filter(([path]) => path > afterPath).slice(0, limit).map(row) };
    }
    if (text === FETCH_BY_PATH_SQL) {
      if (this.hangFetch) {
        return new Promise(() => {});
      }
      const wanted = new Set(values[0]);
      this.fetchedPaths.push(...wanted);
      return { rows: sorted().filter(([path]) => wanted.has(path)).map(row) };
    }
    assert.equal(values.length, 3, 'a warm-up query carries exactly one literal');
    assert.ok(!/\bOR\b/u.test(text), 'a warm-up query never ORs literals');
    if (this.candidateDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.candidateDelayMs));
    }
    const [literal, afterPath, limit] = values;
    return {
      rows: sorted()
        .filter(([path, docText]) => path > afterPath && docText.includes(literal))
        .slice(0, limit)
        .map(([path, docText]) => ({ path, text: docText })),
    };
  }
}

function storeDocsFor(files, { exclude = [] } = {}) {
  return files
    .filter(([path]) => path.endsWith('.md') && !exclude.includes(path))
    .map(([path, body]) => [path, storeText(path, body)]);
}

function quietLogger() {
  const lines = { log: [], warn: [] };
  return {
    lines,
    log: (line) => lines.log.push(line),
    warn: (line) => lines.warn.push(line),
  };
}

async function waitFor(predicate, label) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 5_000) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const providersToClose = [];
test.after(async () => {
  await Promise.all(providersToClose.map((provider) => provider.close()));
});

/** mode 'link map': the map is built before the first request; 'warm-up': it never finishes. */
async function createPair(files, { cutPaths = [], exclude = [], mode = 'link map', providerOptions = {} } = {}) {
  const vaultFileStore = new StubVaultStore(files);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  const index = new BacklinkIndex({ vaultFileStore: new StubVaultStore(files) });
  await index.build({ workspaceState });

  const pg = new FakeDocsStore(storeDocsFor(files, { exclude }), { cutPaths });
  const logger = quietLogger();
  const provider = new PgBacklinkProvider({ logger, mapBatchPauseMs: 0, mapBatchRows: 7, pg, vaultFileStore, ...providerOptions });
  providersToClose.push(provider);
  if (mode === 'warm-up') {
    pg.holdMap = true;
    void provider.start({ workspaceState });
    await waitFor(() => provider._gapIndex !== null, 'the gap index');
    assert.equal(provider.mapReady, false);
  } else {
    await provider.start({ workspaceState });
    assert.equal(provider.mapReady, true);
  }
  return { index, logger, pg, provider, vaultFileStore, workspaceState };
}

async function assertParity(index, provider, files) {
  let totalBacklinks = 0;
  for (const [target] of files) {
    const expected = await index.getBacklinks(target);
    const actual = await provider.getBacklinks(target);
    // Byte-identical API payload, key order included.
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), `parity for ${target}`);
    totalBacklinks += expected.length;
  }
  return totalBacklinks;
}

const files = (entries) => entries.map((entry) => entry.file);

for (const mode of MODES) {
  test(`parity (${mode}): exactly what BacklinkIndex returns, for every file of the fixture vault`, async () => {
    const { index, logger, provider } = await createPair(FIXTURE, { mode });
    const totalBacklinks = await assertParity(index, provider, FIXTURE);
    // Guard against a vacuous pass (e.g. both sides empty).
    assert.ok(totalBacklinks >= 11, `expected a populated fixture, got ${totalBacklinks} backlinks`);
    assert.deepEqual(logger.lines.warn, []);
  });

  test(`parity (${mode}) holds with gap files and a document cut at the store's cap`, async () => {
    const { index, provider } = await createPair(FIXTURE, {
      cutPaths: ['sources/qualified.md'],
      exclude: ['sources/plain.md', 'parity/fence.md', 'assets/local.md'],
      mode,
    });
    await assertParity(index, provider, FIXTURE);
  });

  test(`negative cases (${mode}): mention, same-stem file, ambiguous basename elsewhere, case, markdown link, self link`, async () => {
    const { provider } = await createPair(FIXTURE, { mode });
    const targetSources = files(await provider.getBacklinks('notes/target.md'));
    assert.ok(!targetSources.includes('negatives/mention.md'), 'plain-text mention is not a backlink');
    assert.ok(!targetSources.includes('negatives/other-stem.md'), 'a link to a same-stem different file is not a backlink');
    assert.deepEqual(files(await provider.getBacklinks('other/target-notes.md')), ['negatives/other-stem.md']);
    assert.deepEqual(files(await provider.getBacklinks('notes/target.png')), ['negatives/other-stem.md']);
    // [[dup]] resolves to the first dup.md in workspace order (a/dup.md), never to b/dup.md.
    assert.deepEqual(files(await provider.getBacklinks('a/dup.md')), ['negatives/dup-elsewhere.md']);
    assert.deepEqual(files(await provider.getBacklinks('b/dup.md')), ['parity/dup-b.md']);
    assert.deepEqual(files(await provider.getBacklinks('names/C-EFFORT.md')), ['sources/names.md'], '[[c-effort]] does not count');
    assert.deepEqual(await provider.getBacklinks('x.md'), [], '[x](../x.md) is not a backlink in either mode');
    assert.deepEqual(await provider.getBacklinks('notes/self.md'), [], 'self links do not count');
  });

  test(`non-markdown targets (${mode}): wiki embeds, relative and percent-encoded image links`, async () => {
    const { provider } = await createPair(FIXTURE, { mode });
    assert.deepEqual(files(await provider.getBacklinks('assets/img.png')), ['assets/local.md', 'sources/embeds.md', 'sources/relative.md']);
    assert.deepEqual(files(await provider.getBacklinks('assets/my pic.png')), ['sources/relative.md']);
    assert.deepEqual(files(await provider.getBacklinks('assets/Pasted image 20260125155427.png')), ['sources/pasted.md']);
    assert.deepEqual(files(await provider.getBacklinks('assets/diagram.excalidraw')), ['sources/embeds.md']);
  });

  test(`regression G2.a (${mode}): a common-word target keeps a linker that sorts after 500+ prose mentions`, async () => {
    const prose = Array.from({ length: 520 }, (_, index) => [`a-prose/${String(index).padStart(3, '0')}.md`, 'An Agent wrote this; Agent is a common word.']);
    const vault = [['Agent.md', '# Agent'], ...prose, ['zz/early-is-not-enough.md', 'x'], ['zzz/late-linker.md', 'See [[Agent]].']];
    const { index, pg, provider } = await createPair(vault, { mode, providerOptions: { warmupTimeoutMs: 30_000 } });
    assert.equal(JSON.stringify(await provider.getBacklinks('Agent.md')), JSON.stringify(await index.getBacklinks('Agent.md')));
    assert.deepEqual(files(await provider.getBacklinks('Agent.md')), ['zzz/late-linker.md']);
    if (mode === 'link map') {
      // The map is exact: only the real linker's text is fetched, never the 520 prose mentions.
      assert.deepEqual([...new Set(pg.fetchedPaths)], ['zzz/late-linker.md']);
    }
  });
}

test('positive edge cases reach notes/target.md: alias, heading, qualified, extension, embed, repeated, code fence', async () => {
  const { provider } = await createPair(FIXTURE);
  assert.deepEqual(await provider.getBacklinks('notes/target.md'), [
    { file: 'parity/fence.md', contexts: ['[[target]] inside a code fence'] },
    { file: 'sources/alias.md', contexts: [
      'Alias [[target|the target]] and heading [[target#Section]].',
      'Alias [[target|the target]] and heading [[target#Section]].',
    ] },
    { file: 'sources/embeds.md', contexts: ['Embed ![[img.png]] and ![[diagram.excalidraw]] and ![[target]].'] },
    { file: 'sources/plain.md', contexts: [
      'Plain [[target]].',
      'Twice on one line [[target]] and [[target]].',
      'Twice on one line [[target]] and [[target]].',
    ] },
    { file: 'sources/qualified.md', contexts: [
      'Qualified [[notes/target]] and with extension [[notes/target.md]].',
      'Qualified [[notes/target]] and with extension [[notes/target.md]].',
    ] },
  ]);
});

test('tokenizer-stressing names resolve', async () => {
  const { provider } = await createPair(FIXTURE, { mode: 'warm-up' });
  for (const target of ['names/C-EFFORT.md', 'names/Über Notiz.md', 'names/snake_case_note.md', 'names/日本語ノート.md']) {
    assert.deepEqual(files(await provider.getBacklinks(target)), ['sources/names.md'], target);
  }
});

test('link keys: a source is filed under the raw target key its references carry', () => {
  assert.deepEqual(extractLinkKeys('s/a.md', 'x [[ Target |alias]] ![[img.png]] [[dir/b#h]] ![p](../assets/my%20pic.png) [m](../x.md)'), [
    'Target.md',
    'img.png',
    'dir/b.md',
    'assets/my pic.png',
  ]);
  const wikiTargetIndex = createWikiTargetIndex(['a/dup.md', 'b/dup.md', 'notes/target.md', 'assets/my pic.png']);
  assert.deepEqual(buildTargetLinkKeys('notes/target.md', wikiTargetIndex), ['notes/target.md', 'target.md']);
  // The bare stem resolves to a/dup.md, so b/dup.md is only reachable by a qualified key.
  assert.deepEqual(buildTargetLinkKeys('b/dup.md', wikiTargetIndex), ['b/dup.md']);
  assert.deepEqual(buildTargetLinkKeys('assets/my pic.png', wikiTargetIndex), ['assets/my pic.png', 'my pic.png']);
});

test('warm-up literals: only keys that resolve to the target, minimal for a substring filter', () => {
  const wikiTargetIndex = createWikiTargetIndex(['a/dup.md', 'b/dup.md', 'notes/target.md', 'assets/my pic.png']);
  assert.deepEqual(buildCandidateLiterals('notes/target.md', wikiTargetIndex), ['target']);
  assert.deepEqual(buildCandidateLiterals('a/dup.md', wikiTargetIndex), ['dup']);
  assert.deepEqual(buildCandidateLiterals('b/dup.md', wikiTargetIndex), ['b/dup']);
  assert.deepEqual(buildCandidateLiterals('assets/my pic.png', wikiTargetIndex), ['my pic.png', 'my%20pic.png']);
  assert.deepEqual(buildCandidateLiterals('missing.md', wikiTargetIndex), []);
});

test('regression G2.c: a warm-up query carries ONE literal (never ORed); a token-less literal drops the phrase', () => {
  const query = buildCandidateQuery('b/dup', { afterPath: 'm.md', limit: 100 });
  assert.equal(
    query.text,
    'SELECT path, text FROM wisdom_docs WHERE text ### $1::text AND strpos(text, $1::text) > 0 AND path > $2::text ORDER BY path LIMIT $3::int',
  );
  assert.deepEqual(query.values, ['b/dup', 'm.md', 100]);
  const tokenless = buildCandidateQuery('+++');
  assert.ok(!tokenless.text.includes('###'), 'a literal with no letter or digit would phrase-match nothing');
});

test('regression G2.c: a two-literal image target issues one query per literal', async () => {
  const { pg, provider } = await createPair(FIXTURE, { mode: 'warm-up' });
  pg.queries.length = 0;
  assert.deepEqual(files(await provider.getBacklinks('assets/Pasted image 20260125155427.png')), ['sources/pasted.md']);
  const literals = pg.queries.filter((query) => query.values.length === 3).map((query) => query.values[0]);
  assert.deepEqual(literals, ['Pasted image 20260125155427.png', 'Pasted%20image%2020260125155427.png']);
});

test('the store path-words line cannot create a reference (text is used as stored)', async () => {
  const vault = [['target.md', '# t'], ['dir/target/note.md', 'no links here']];
  for (const mode of MODES) {
    const { provider } = await createPair(vault, { mode });
    assert.deepEqual(await provider.getBacklinks('target.md'), []);
  }
});

test('warm-up has no row cap: 230 linkers across three pages are all found', async () => {
  const sources = Array.from({ length: 230 }, (_, index) => [`s/${String(index).padStart(3, '0')}.md`, 'See [[hub]].']);
  const vault = [['hub.md', '# hub'], ...sources];
  const { index, pg, provider } = await createPair(vault, { mode: 'warm-up' });
  assert.equal(JSON.stringify(await provider.getBacklinks('hub.md')), JSON.stringify(await index.getBacklinks('hub.md')));
  assert.equal((await provider.getBacklinks('hub.md')).length, 230);
  assert.ok(pg.queries.filter((query) => query.text.includes('###')).length >= 3, 'paged in pages of 100');
});

test('warm-up deadline: a cut-short request keeps its partial result and warns naming the target; it is no outage', async () => {
  const { logger, pg, provider } = await createPair(FIXTURE, { mode: 'warm-up', providerOptions: { warmupTimeoutMs: 40 } });
  pg.candidateDelayMs = 200;
  provider.updateFile('sources/alias.md', 'edited [[target]]');
  const backlinks = await provider.getBacklinks('notes/target.md');
  assert.ok(files(backlinks).includes('sources/alias.md'));
  assert.ok(logger.lines.warn.some((line) => line.startsWith('[backlinks] notes/target.md: Postgres part cut short after 40 ms (warm-up)')));
  assert.ok(!logger.lines.warn.some((line) => line.includes('Postgres unavailable')));
});

test('timeout is not an outage (link map): a hanging fetch warns per request, never "Postgres unavailable"', async () => {
  const { logger, pg, provider } = await createPair(FIXTURE, { providerOptions: { timeoutMs: 50 } });
  pg.hangFetch = true;
  await provider.getBacklinks('notes/target.md');
  await provider.getBacklinks('notes/target.md');
  assert.equal(logger.lines.warn.filter((line) => line.includes('notes/target.md: Postgres part cut short after 50 ms (link map)')).length, 2);
  assert.ok(!logger.lines.warn.some((line) => line.includes('Postgres unavailable')));
});

test('link map: streamed in keyset batches of mapBatchRows', async () => {
  const { pg } = await createPair(FIXTURE, { providerOptions: { mapBatchRows: 7 } });
  const batches = pg.queries.filter((query) => query.text === MAP_BATCH_SQL);
  const storeRows = FIXTURE.filter(([path]) => path.endsWith('.md')).length;
  assert.equal(batches.length, Math.floor(storeRows / 7) + 1);
  assert.deepEqual(batches.map((query) => query.values[1]), batches.map(() => 7));
  assert.equal(batches[0].values[0], '');
  assert.ok(batches.slice(1).every((query, index) => query.values[0] > batches[index].values[0]), 'the cursor only advances');
});

test('link map: a build interrupted by a store failure resumes at the next poll and becomes exact', async () => {
  const vaultFileStore = new StubVaultStore(FIXTURE);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  const pg = new FakeDocsStore(storeDocsFor(FIXTURE));
  pg.failMapBatchesOnce = 1;
  const logger = quietLogger();
  const provider = new PgBacklinkProvider({ logger, mapBatchPauseMs: 0, mapBatchRows: 7, pg, vaultFileStore });
  providersToClose.push(provider);
  await provider.start({ workspaceState });
  assert.equal(provider.mapReady, false);
  assert.equal(logger.lines.warn.filter((line) => line.includes('Postgres unavailable')).length, 1);
  await provider.pollStore();
  assert.equal(provider.mapReady, true);
  const index = new BacklinkIndex({ vaultFileStore: new StubVaultStore(FIXTURE) });
  await index.build({ workspaceState });
  await assertParity(index, provider, FIXTURE);
});

test('freshness: a link the store gains appears after the next poll; a link it loses disappears at once', async () => {
  const vault = [['target.md', '# t'], ['src.md', 'no link'], ['old.md', 'see [[target]]']];
  const { pg, provider } = await createPair(vault);
  assert.deepEqual(files(await provider.getBacklinks('target.md')), ['old.md']);

  pg.docs.set('src.md', storeText('src.md', 'now [[target]]'));
  pg.docs.set('old.md', storeText('old.md', 'link gone'));
  assert.deepEqual(files(await provider.getBacklinks('target.md')), [], 'removed at once; added only after the poll');
  pg.queries.length = 0;
  await provider.pollStore();
  const refetched = pg.queries.filter((query) => query.text === FETCH_BY_PATH_SQL).flatMap((query) => query.values[0]);
  assert.deepEqual(refetched.sort(), ['old.md', 'src.md'], 'only changed rows are re-read');
  assert.deepEqual(files(await provider.getBacklinks('target.md')), ['src.md']);
});

test('memory: the gap index resolves with the wiki index of the provider (one copy), also after a file is created', async () => {
  const { provider, vaultFileStore, workspaceState } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  assert.equal(provider._gapIndex._wikiTargetIndex, provider._wikiTargetIndex);

  vaultFileStore.files.set('new/note.md', 'new [[target]]');
  const nextState = await vaultFileStore.scanWorkspaceState();
  await provider.applyWorkspaceChange({ changedPaths: ['new/note.md'] }, { nextState, previousState: workspaceState });
  assert.equal(provider._gapIndex._wikiTargetIndex, provider._wikiTargetIndex);
  assert.ok(provider._wikiTargetIndex.exactPaths.has('new/note.md'));
});

test('memory: an unchanged file list keeps the wiki index; a changed one rebuilds it', async () => {
  const { provider, vaultFileStore, workspaceState } = await createPair(FIXTURE);
  const before = provider._wikiTargetIndex;
  vaultFileStore.files.set('sources/alias.md', 'edited, same membership');
  await provider.applyWorkspaceChange({ changedPaths: ['sources/alias.md'] }, { nextState: workspaceState, previousState: workspaceState });
  assert.equal(provider._wikiTargetIndex, before, 'a save that changes no membership must not rebuild the index');

  vaultFileStore.files.set('extra.md', '# extra');
  const nextState = await vaultFileStore.scanWorkspaceState();
  await provider.applyWorkspaceChange({ changedPaths: ['extra.md'] }, { nextState, previousState: workspaceState });
  assert.notEqual(provider._wikiTargetIndex, before);
  assert.ok(provider._wikiTargetIndex.exactPaths.has('extra.md'));
});

test('overlay: an edit through updateFile shows at once although the store still has the old text', async () => {
  const vault = [['target.md', '# t'], ['src.md', 'no link yet']];
  const { provider } = await createPair(vault);
  assert.deepEqual(await provider.getBacklinks('target.md'), []);
  provider.updateFile('src.md', 'now [[target]]');
  assert.deepEqual(await provider.getBacklinks('target.md'), [{ file: 'src.md', contexts: ['now [[target]]'] }]);
});

test('overlay (G5): past the window it stays while the store is stale, leaves once the store caught up, and is bounded', async () => {
  let now = 1_000_000;
  const vault = [['target.md', '# t'], ['src.md', 'no link yet'], ['scratch.md', 'no link yet']];
  const { pg, provider } = await createPair(vault, { providerOptions: { now: () => now, overlayMaxMs: 3_600_000, overlayWindowMs: 60_000 } });
  provider.updateFile('src.md', 'now [[target]]');
  provider.updateFile('scratch.md', 'scratch [[target]]');

  now += 60_001;
  await provider.pollStore();
  assert.deepEqual(files(await provider.getBacklinks('target.md')), ['scratch.md', 'src.md'], 'the store has not re-read either file: both stay');

  // The store re-reads src.md (its hash changes); scratch.md waits for the full walk.
  pg.docs.set('src.md', storeText('src.md', 'now [[target]]'));
  await provider.pollStore();
  assert.ok(!provider._overlay.has('src.md'), 'caught up: the overlay entry is gone');
  assert.ok(provider._overlay.has('scratch.md'), 'still stale: the overlay entry stays');
  assert.deepEqual(files(await provider.getBacklinks('target.md')), ['scratch.md', 'src.md'], 'src.md now comes from the store');

  now += 3_600_000;
  await provider.pollStore();
  assert.ok(!provider._overlay.has('scratch.md'), 'the upper bound drops it even while the store stays stale');
  assert.deepEqual(files(await provider.getBacklinks('target.md')), ['src.md']);
});

test('overlay (G5): a gap file drops at the window (the gap index holds its disk content)', async () => {
  let now = 1_000_000;
  const { provider } = await createPair(FIXTURE, { exclude: ['sources/plain.md'], providerOptions: { now: () => now, overlayWindowMs: 60_000 } });
  provider.updateFile('sources/plain.md', 'gap edit [[target]]');
  now += 60_001;
  await provider.pollStore();
  assert.ok(!provider._overlay.has('sources/plain.md'));
  assert.ok(files(await provider.getBacklinks('notes/target.md')).includes('sources/plain.md'), 'served by the gap index');
});

test('G4.f2: the first successful request after an outage refreshes the gap set and builds the link map at once', async () => {
  const vaultFileStore = new StubVaultStore(FIXTURE);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  const pg = new FakeDocsStore(storeDocsFor(FIXTURE, { exclude: ['sources/plain.md'] }));
  pg.failWith = new Error('connect ECONNREFUSED');
  const provider = new PgBacklinkProvider({ logger: quietLogger(), mapBatchPauseMs: 0, pg, storePollMs: 3_600_000, vaultFileStore });
  providersToClose.push(provider);
  await provider.start({ workspaceState });
  assert.equal(provider._gapIndex, null);

  pg.failWith = null;
  await provider.getBacklinks('notes/target.md');
  await waitFor(() => provider.mapReady && provider._gapIndex !== null, 'the recovery poll');
  assert.ok(files(await provider.getBacklinks('notes/target.md')).includes('sources/plain.md'), 'the gap file is back without waiting for the next poll');
});

test('M1 (intended difference): after a target rename, memory mode keeps [[old]] via its alias map until restart; postgres mode does not', async () => {
  const vault = [['old-name.md', '# t'], ['linker.md', 'see [[old-name]]']];
  const { index, provider, vaultFileStore, workspaceState } = await createPair(vault);
  vaultFileStore.files.delete('old-name.md');
  vaultFileStore.files.set('new-name.md', '# t');
  const nextState = await vaultFileStore.scanWorkspaceState();
  const change = { renamedPaths: [{ newPath: 'new-name.md', oldPath: 'old-name.md' }] };
  index.onFileRenamed('old-name.md', 'new-name.md');
  await provider.applyWorkspaceChange(change, { nextState, previousState: workspaceState });

  assert.deepEqual(files(await index.getBacklinks('new-name.md')), ['linker.md'], 'memory mode: alias kept until restart');
  assert.deepEqual(await provider.getBacklinks('new-name.md'), [], 'postgres mode: [[old-name]] no longer resolves');
  // Postgres mode equals memory mode after a restart (a fresh build).
  const restarted = new BacklinkIndex({ vaultFileStore: new StubVaultStore([...vaultFileStore.files]) });
  await restarted.build({ workspaceState: nextState });
  assert.equal(JSON.stringify(await provider.getBacklinks('new-name.md')), JSON.stringify(await restarted.getBacklinks('new-name.md')));
});

test('G4.f1: each query carries a server-side statement_timeout of the time left; a late checkout never runs; cancels keep the connection', async () => {
  const log = [];
  let releaseLater = null;
  const makeClient = (name) => ({
    query: async (config) => {
      log.push([name, typeof config === 'string' ? config : config.text]);
      if (typeof config !== 'string' && config.text === 'cancel me') {
        const error = new Error('canceling statement due to statement timeout');
        error.code = '57014';
        throw error;
      }
      if (typeof config !== 'string' && config.text === 'break me') {
        throw new Error('connection reset');
      }
      return { rows: [] };
    },
    release: (error) => log.push([name, `release:${error ? 'discard' : 'reuse'}`]),
  });
  const pool = {
    connect: () => (releaseLater ? new Promise((resolve) => { releaseLater = () => resolve(makeClient('late')); }) : Promise.resolve(makeClient('c'))),
    end: async () => {},
  };
  const client = createPgDocsClient({ createPool: () => pool, database: 'd', host: 'h', user: 'u' });

  await client.query({ text: 'SELECT 1' }, { timeoutMs: 2_000 });
  assert.match(log[0][1], /^SET statement_timeout = (199\d|2000)$/u);
  assert.deepEqual(log.slice(1), [['c', 'SELECT 1'], ['c', 'release:reuse']]);

  log.length = 0;
  await assert.rejects(client.query({ text: 'cancel me' }, { timeoutMs: 500 }), /statement timeout/u);
  assert.deepEqual(log.at(-1), ['c', 'release:reuse'], 'a server-side cancel leaves the connection usable');
  log.length = 0;
  await assert.rejects(client.query({ text: 'break me' }, { timeoutMs: 500 }), /connection reset/u);
  assert.deepEqual(log.at(-1), ['c', 'release:discard']);

  log.length = 0;
  releaseLater = () => {};
  await assert.rejects(client.query({ text: 'SELECT late' }, { timeoutMs: 30 }), /no Postgres connection free within 30 ms/u);
  releaseLater();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(log, [['late', 'release:reuse']], 'the late connection is handed back without running anything');
});

test('overlay: removing a link through updateFile removes the backlink although the store still has it', async () => {
  const vault = [['target.md', '# t'], ['src.md', 'see [[target]]']];
  const { provider } = await createPair(vault);
  assert.equal((await provider.getBacklinks('target.md')).length, 1);
  provider.updateFile('src.md', 'link removed');
  assert.deepEqual(await provider.getBacklinks('target.md'), []);
});

test('overlay: applyWorkspaceChange (an edit seen on disk) reads the changed file into the overlay', async () => {
  const vault = [['target.md', '# t'], ['src.md', 'no link']];
  const { provider, vaultFileStore, workspaceState } = await createPair(vault);
  vaultFileStore.files.set('src.md', 'disk edit [[target]]');
  await provider.applyWorkspaceChange({ changedPaths: ['src.md'] }, { nextState: workspaceState, previousState: workspaceState });
  assert.deepEqual(await provider.getBacklinks('target.md'), [{ file: 'src.md', contexts: ['disk edit [[target]]'] }]);
});

test('gap set: a file absent from the store is found via the gap index; only gap files are read from disk', async () => {
  const { provider, vaultFileStore } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  assert.ok(files(await provider.getBacklinks('notes/target.md')).includes('sources/plain.md'));
  // No full-vault read: the startup reads were exactly the gap file.
  assert.deepEqual(vaultFileStore.reads, ['sources/plain.md']);
});

test('gap set: a document the store holds cut at its cap is served from disk, not from the cut text', async () => {
  const vault = [['target.md', '# t'], ['big.md', 'see [[target]] (the store cut this one)']];
  const vaultFileStore = new StubVaultStore(vault);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  // The store copy lost the link past its cap.
  const pg = new FakeDocsStore([['big.md', storeText('big.md', 'see')], ['target.md', storeText('target.md', '# t')]], { cutPaths: ['big.md'] });
  const provider = new PgBacklinkProvider({ logger: quietLogger(), mapBatchPauseMs: 0, pg, vaultFileStore });
  providersToClose.push(provider);
  await provider.start({ workspaceState });
  assert.deepEqual(files(await provider.getBacklinks('target.md')), ['big.md']);
  assert.ok(STORE_POLL_SQL.includes(`octet_length(text) >= ${STORE_TEXT_CAP_CHARS}`));
});

test('gap set: a file in both the gap index and the store results is listed once', async () => {
  for (const mode of MODES) {
    const { pg, provider } = await createPair(FIXTURE, { exclude: ['sources/plain.md'], mode });
    // The store indexes the file after the gap refresh: both parts now hold it.
    pg.docs.set('sources/plain.md', storeText('sources/plain.md', FIXTURE.find(([path]) => path === 'sources/plain.md')[1]));
    const sources = files(await provider.getBacklinks('notes/target.md'));
    assert.equal(sources.filter((source) => source === 'sources/plain.md').length, 1, mode);
  }
});

test('gap set: the next poll moves files between the gap index and the store without a full rebuild', async () => {
  const { pg, provider, vaultFileStore } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  pg.docs.set('sources/plain.md', storeText('sources/plain.md', 'Plain [[target]].'));
  pg.docs.delete('sources/alias.md');
  vaultFileStore.reads.length = 0;
  await provider.pollStore();
  assert.deepEqual(vaultFileStore.reads, ['sources/alias.md']);
  const sources = files(await provider.getBacklinks('notes/target.md'));
  assert.ok(sources.includes('sources/alias.md') && sources.includes('sources/plain.md'));
});

test('degradation: Postgres unreachable yields overlay + gap results, one warning across calls, no exception', async () => {
  for (const mode of MODES) {
    const { logger, pg, provider } = await createPair(FIXTURE, { exclude: ['sources/plain.md'], mode });
    provider.updateFile('sources/alias.md', 'edited [[target]]');
    pg.failWith = new Error('connect ECONNREFUSED');
    const first = await provider.getBacklinks('notes/target.md');
    const second = await provider.getBacklinks('notes/target.md');
    assert.deepEqual(files(first), ['sources/alias.md', 'sources/plain.md'], mode);
    assert.deepEqual(second, first);
    assert.equal(logger.lines.warn.filter((line) => line.includes('Postgres unavailable')).length, 1, mode);

    pg.failWith = null;
    assert.ok((await provider.getBacklinks('notes/target.md')).length > 2, `${mode}: recovers once Postgres answers`);
    assert.ok(logger.lines.log.some((line) => line.includes('reachable again')), mode);
  }
});

test('degradation: a hanging Postgres query is cut at the timeout', async () => {
  const { pg, provider } = await createPair(FIXTURE, { providerOptions: { timeoutMs: 50 } });
  provider.updateFile('sources/alias.md', 'edited [[target]]');
  pg.hang = true;
  const startedAt = Date.now();
  const backlinks = await provider.getBacklinks('notes/target.md');
  assert.ok(Date.now() - startedAt < 2_000);
  assert.deepEqual(files(backlinks), ['sources/alias.md']);
});

test('close() does not wait on a hanging gap refresh or a hanging pool end', async () => {
  const pg = new FakeDocsStore([]);
  pg.hang = true;
  pg.end = () => new Promise(() => {});
  const vaultFileStore = new StubVaultStore([['a.md', '# a']]);
  const provider = new PgBacklinkProvider({ logger: quietLogger(), pg, vaultFileStore });
  void provider.start({ workspaceState: await vaultFileStore.scanWorkspaceState() });
  const startedAt = Date.now();
  await provider.close();
  assert.ok(Date.now() - startedAt < 3_000, `close took ${Date.now() - startedAt} ms`);
});

test('config: default source is memory; an unknown source or missing connection settings fail loudly', () => {
  assert.equal(loadBacklinksConfig({}).source, 'memory');
  assert.equal(loadBacklinksConfig({}).pg, undefined);
  assert.throws(() => loadBacklinksConfig({ COLLABMD_BACKLINKS_SOURCE: 'postgress' }), /must be one of/);
  assert.throws(() => loadBacklinksConfig({ COLLABMD_BACKLINKS_SOURCE: 'postgres', COLLABMD_PG_HOST: 'h' }), /COLLABMD_PG_DATABASE, COLLABMD_PG_USER/);
  assert.throws(() => loadBacklinksConfig({
    COLLABMD_BACKLINKS_SOURCE: 'postgres', COLLABMD_PG_DATABASE: 'd', COLLABMD_PG_HOST: 'h', COLLABMD_PG_SSLMODE: 'prefer', COLLABMD_PG_USER: 'u',
  }), /COLLABMD_PG_SSLMODE/);
  const config = loadBacklinksConfig({
    COLLABMD_BACKLINKS_SOURCE: 'postgres', COLLABMD_PG_DATABASE: 'd', COLLABMD_PG_HOST: 'h', COLLABMD_PG_USER: 'u',
  });
  assert.deepEqual(config.pg, { database: 'd', host: 'h', password: '', port: 5432, sslmode: 'require', user: 'u' });
  assert.deepEqual(
    [config.storePollMs, config.timeoutMs, config.warmupTimeoutMs, config.mapBatchRows, config.mapBatchPauseMs, config.overlayWindowMs],
    [60_000, 2_000, 10_000, 32, 20, 600_000],
  );
  assert.equal(loadBacklinksConfig({ COLLABMD_BACKLINKS_MAP_BATCH_PAUSE_MS: '0' }).mapBatchPauseMs, 0, 'no pause is a valid setting');
});

// --- startup contract (the real app server) ---

async function createVault(t, files) {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-pg-backlinks-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  await Promise.all(files.map(async ([pathValue, content]) => {
    const absolutePath = join(vaultDir, pathValue);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }));
  return vaultDir;
}

async function startServer(t, { backlinksPg = null, pgOverrides = {}, source }) {
  const vaultDir = await createVault(t, FIXTURE);
  const baseConfig = loadConfig({ vaultDir });
  const config = {
    ...baseConfig,
    backlinks: source === 'postgres'
      ? { ...baseConfig.backlinks, pg: { database: 'd', host: '127.0.0.1', password: '', port: 1, sslmode: 'disable', user: 'u', ...pgOverrides }, source, timeoutMs: 500 }
      : baseConfig.backlinks,
    fileWatcherEnabled: false,
    host: '127.0.0.1',
    nodeEnv: 'test',
    port: 0,
    wsRoomIdleGraceMs: 0,
  };
  const server = createAppServer(config, { backlinksPg });
  t.after(() => server.close());

  let buildCalls = 0;
  const originalBuild = server.backlinkIndex.build.bind(server.backlinkIndex);
  server.backlinkIndex.build = async (...args) => {
    buildCalls += 1;
    return originalBuild(...args);
  };
  const reads = [];
  const originalRead = server.vaultFileStore.readMarkdownFile.bind(server.vaultFileStore);
  server.vaultFileStore.readMarkdownFile = async (pathValue) => {
    reads.push(pathValue);
    return originalRead(pathValue);
  };

  const { port } = await server.listen();
  return { buildCalls: () => buildCalls, port, reads, server };
}

test('startup contract: postgres mode never builds the full index, and /health answers before any gap build finishes', async (t) => {
  const hangingPg = new FakeDocsStore([]);
  hangingPg.hang = true;
  const { buildCalls, port, reads, server } = await startServer(t, { backlinksPg: hangingPg, source: 'postgres' });

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal(buildCalls(), 0);
  assert.deepEqual(reads, [], 'no vault file content is read at startup');
  assert.ok(hangingPg.queries.some((query) => query.text === STORE_POLL_SQL), 'the store poll started (and is still pending)');
  assert.equal(server.backlinkIndex._gapIndex, null, 'no gap index exists yet');
  assert.equal(server.backlinkIndex.mapReady, false, 'no link map yet');
});

test('startup contract (negative): default mode still builds the full index before listen', async (t) => {
  const { buildCalls, reads, server } = await startServer(t, { source: 'memory' });
  assert.ok(server.backlinkIndex instanceof BacklinkIndex);
  assert.equal(buildCalls(), 1);
  assert.ok(reads.length >= FIXTURE.filter(([path]) => path.endsWith('.md')).length);
});

test('startup with Postgres unreachable (real pg client) reaches listen and the panel API answers 200', async (t) => {
  const { port } = await startServer(t, { source: 'postgres' });
  const response = await fetch(`http://127.0.0.1:${port}/api/backlinks?file=${encodeURIComponent('notes/target.md')}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { backlinks: [], file: 'notes/target.md' });
});

// --- the real store: PostgreSQL + pg_search of the version wisdom-pg runs ---
//
// Runs where COLLABMD_TEST_PG_ADMIN_URL names a superuser connection to a PostgreSQL with
// pg_search available (wisdom-pg: PostgreSQL 17.11 + pg_search 0.26.6). It creates a
// throwaway database with the production wisdom_docs DDL and BM25 index, a SELECT-only
// role, and runs the provider through the real pg client. Skipped elsewhere.
const REAL_PG_ADMIN_URL = process.env.COLLABMD_TEST_PG_ADMIN_URL ?? '';

// Copied from argocd-master-application wisdom-pg/base/admin/schema.sql (§B.5 wisdom_docs).
const WISDOM_DOCS_DDL = [
  `CREATE TABLE public.wisdom_docs (
    id uuid PRIMARY KEY, path text NOT NULL, handle text NOT NULL, brick_id text, area text,
    scratch boolean NOT NULL DEFAULT false, hash text NOT NULL, title text, mtime timestamptz, text text, bm25_text text)`,
  'CREATE INDEX wisdom_docs_path ON public.wisdom_docs (path)',
  `CREATE INDEX wisdom_docs_bm25 ON public.wisdom_docs USING bm25
    (id, (text::pdb.simple('ascii_folding=true')), (bm25_text::pdb.simple('stemmer=english', 'stopwords_language=english', 'ascii_folding=true')),
     (path::pdb.literal), (brick_id::pdb.literal), (area::pdb.literal), scratch)`,
  'ALTER INDEX public.wisdom_docs_bm25 SET (mutable_segment_rows=0)',
];

test('real pg_search: parity in both modes on every fixture file, paging, cut docs, least-privilege role, index scans', {
  skip: REAL_PG_ADMIN_URL ? false : 'set COLLABMD_TEST_PG_ADMIN_URL to run against a real pg_search',
  timeout: 120_000,
}, async (t) => {
  const { default: pg } = await import('pg');
  const suffix = `${process.pid}_${Date.now()}`;
  const database = `collabmd_backlinks_${suffix}`;
  const role = `collabmd_backlinks_${suffix}`;
  const admin = new pg.Client({ connectionString: REAL_PG_ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.query(`CREATE ROLE ${role} LOGIN`);
  // One hook, in order: close every connection into the database before dropping it.
  const closeFirst = [];
  t.after(async () => {
    for (const close of closeFirst.reverse()) {
      await close();
    }
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });

  const adminUrl = new URL(REAL_PG_ADMIN_URL);
  adminUrl.pathname = `/${database}`;
  const owner = new pg.Client({ connectionString: adminUrl.toString() });
  await owner.connect();
  closeFirst.push(() => owner.end());
  await owner.query('CREATE EXTENSION IF NOT EXISTS pg_search CASCADE');
  const { rows: [{ extversion }] } = await owner.query("SELECT extversion FROM pg_extension WHERE extname = 'pg_search'");
  t.diagnostic(`pg_search ${extversion}; ${(await owner.query('SELECT version()')).rows[0].version}`);
  for (const statement of WISDOM_DOCS_DDL) {
    await owner.query(statement);
  }

  const hubSources = Array.from({ length: 230 }, (_, index) => [`hub-sources/${String(index).padStart(3, '0')}.md`, 'See [[hub]].']);
  const files = [...FIXTURE, ['hub.md', '# hub'], ...hubSources, ['big/cut.md', 'kept on disk [[target]]']];
  const insertDoc = (path, text) => owner.query(
    `INSERT INTO wisdom_docs (id, path, handle, area, hash, title, text, bm25_text)
     VALUES (gen_random_uuid(), $1, 'brain/' || $1, split_part($1, '/', 1), md5($2), $1, $2, $2)`,
    [path, text],
  );
  // Row by row, as the store's writer lands documents (many small segments).
  for (const [path, body] of storeDocsFor(files, { exclude: ['sources/plain.md', 'big/cut.md'] })) {
    await insertDoc(path, body);
  }
  // A document stored cut at the cap: its stored text lost the link.
  await insertDoc('big/cut.md', storeText('big/cut.md', 'x'.repeat(STORE_TEXT_CAP_CHARS)));

  await owner.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await owner.query(`GRANT SELECT ON wisdom_docs TO ${role}`);

  const vaultFileStore = new StubVaultStore(files);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  const index = new BacklinkIndex({ vaultFileStore: new StubVaultStore(files) });
  await index.build({ workspaceState });
  const logger = quietLogger();
  const provider = new PgBacklinkProvider({
    logger,
    pg: createPgDocsClient({
      database,
      host: adminUrl.hostname,
      password: '',
      port: Number(adminUrl.port || 5432),
      sslmode: 'disable',
      timeoutMs: 5_000,
      user: role,
    }),
    mapBatchPauseMs: 0,
    mapBatchRows: 50,
    timeoutMs: 5_000,
    vaultFileStore,
  });
  closeFirst.push(() => provider.close());
  await provider.start({ workspaceState });

  assert.ok(provider._gapSet.has('sources/plain.md'), 'a file missing from the store is a gap file');
  assert.ok(provider._gapSet.has('big/cut.md'), 'a document at the cap is a gap file');
  assert.equal(logger.lines.warn.length, 0, logger.lines.warn.join('\n'));

  assert.equal(provider.mapReady, true);
  for (const mode of ['link map', 'warm-up']) {
    // The warm-up path is what serves until the map is ready; force it on the same store.
    provider._mapReady = mode === 'link map';
    const totalBacklinks = await assertParity(index, provider, files);
    assert.ok(totalBacklinks >= 240, `${mode} populated: ${totalBacklinks}`);
    assert.equal((await provider.getBacklinks('hub.md')).length, 230, `${mode}: all 230 linkers`);
    assert.ok((await provider.getBacklinks('notes/target.md')).some((entry) => entry.file === 'big/cut.md'), mode);
    assert.equal(logger.lines.warn.length, 0, logger.lines.warn.join('\n'));
  }
  provider._mapReady = true;

  // G4.f1: a locked (stuck) store never accumulates backends. Every timed-out request's statement
  // is cancelled by the server at its deadline; the pool (panels + background) stays at <= 2.
  const lock = new pg.Client({ connectionString: adminUrl.toString() });
  await lock.connect();
  closeFirst.push(() => lock.end());
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE wisdom_docs IN ACCESS EXCLUSIVE MODE');
  provider.timeoutMs = 300;
  const backends = async () => Number((await owner.query(
    "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = 'collabmd-backlinks' AND datname = $1 AND state = 'active'",
    [database],
  )).rows[0].n);
  let maxActive = 0;
  const sampler = setInterval(() => { backends().then((n) => { maxActive = Math.max(maxActive, n); }, () => {}); }, 25);
  const answers = await Promise.all(Array.from({ length: 10 }, () => provider.getBacklinks('notes/target.md')));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  clearInterval(sampler);
  const activeAfter = await backends();
  await lock.query('COMMIT');
  t.diagnostic(`stuck store: max active collabmd backends ${maxActive}; active 1.5 s after the last request ${activeAfter}`);
  assert.ok(answers.every((answer) => Array.isArray(answer)), 'every request answered');
  assert.ok(maxActive <= 2, `at most 2 backends, saw ${maxActive}`);
  assert.equal(activeAfter, 0, 'every timed-out statement was cancelled by the server');
  assert.ok(!logger.lines.warn.some((line) => line.includes('Postgres unavailable')), 'a stuck store is a timeout, not an outage');
  provider.timeoutMs = 5_000;
  logger.lines.warn.length = 0;
  assert.equal(JSON.stringify(await provider.getBacklinks('notes/target.md')), JSON.stringify(await index.getBacklinks('notes/target.md')), 'recovers after the lock');

  // Each warm-up literal is its own index scan: the phrase drives the BM25 index and strpos
  // filters only its hits. ORed literals degraded to a heap filter over every row
  // ("indexed_query":"all", VERIFICATION G2.c); one literal per query must never do that.
  await owner.query('ANALYZE wisdom_docs');
  for (const literal of ['C-EFFORT', 'Pasted image 20260125155427.png', 'Pasted%20image%2020260125155427.png']) {
    const query = buildCandidateQuery(literal, { afterPath: '', limit: 100 });
    const plan = (await owner.query({ text: `EXPLAIN (VERBOSE) ${query.text}`, values: query.values })).rows.map((row) => row['QUERY PLAN']).join('\n');
    t.diagnostic(plan);
    assert.match(plan, /Index: wisdom_docs_bm25/u, literal);
    assert.match(plan, /tokenized_phrase/u, literal);
    assert.doesNotMatch(plan, /"indexed_query":"all"/u, literal);
  }
});
