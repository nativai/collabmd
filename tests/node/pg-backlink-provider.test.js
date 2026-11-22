import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { BacklinkIndex } from '../../src/server/domain/backlink-index.js';
import {
  GAP_LIST_SQL,
  PgBacklinkProvider,
  STORE_TEXT_CAP_CHARS,
  buildCandidateLiterals,
  buildCandidateQuery,
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
];

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

/**
 * Evaluates the provider's two queries against an in-memory doc table with the semantics
 * of the SQL: the candidate query keeps rows containing any literal (strpos), path > $after,
 * ordered by path, limited. The phrase predicate is a superset filter checked against real
 * pg_search separately; here only the literal filter decides.
 */
class FakeDocsStore {
  constructor(docs, { cutPaths = [] } = {}) {
    this.docs = new Map(docs);
    this.cutPaths = new Set(cutPaths);
    this.queries = [];
    this.failWith = null;
    this.hang = false;
  }

  async query({ text, values = [] }) {
    this.queries.push({ text, values });
    if (this.hang) {
      return new Promise(() => {});
    }
    if (this.failWith) {
      throw this.failWith;
    }
    if (text === GAP_LIST_SQL) {
      return { rows: [...this.docs.keys()].map((path) => ({ cut: this.cutPaths.has(path), path })) };
    }
    const literals = values.slice(0, -2);
    const [afterPath, limit] = values.slice(-2);
    const rows = [...this.docs.entries()]
      .filter(([path, docText]) => path > afterPath && literals.some((literal) => docText.includes(literal)))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, limit)
      .map(([path, docText]) => ({ path, text: docText }));
    return { rows };
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

async function createPair(files, { cutPaths = [], exclude = [], providerOptions = {} } = {}) {
  const vaultFileStore = new StubVaultStore(files);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  const index = new BacklinkIndex({ vaultFileStore: new StubVaultStore(files) });
  await index.build({ workspaceState });

  const pg = new FakeDocsStore(storeDocsFor(files, { exclude }), { cutPaths });
  const logger = quietLogger();
  const provider = new PgBacklinkProvider({ logger, pg, vaultFileStore, ...providerOptions });
  await provider.start({ workspaceState });
  t_closeLater.push(provider);
  return { index, logger, pg, provider, vaultFileStore, workspaceState };
}

const t_closeLater = [];
test.after(async () => {
  await Promise.all(t_closeLater.map((provider) => provider.close()));
});

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

test('parity: the provider returns exactly what BacklinkIndex returns, for every file of the fixture vault', async () => {
  const { index, provider } = await createPair(FIXTURE);
  const totalBacklinks = await assertParity(index, provider, FIXTURE);
  // Guard against a vacuous pass (e.g. both sides empty).
  assert.ok(totalBacklinks >= 9, `expected a populated fixture, got ${totalBacklinks} backlinks`);
});

test('parity holds when part of the vault is missing from the store (gap files) or cut at its cap', async () => {
  const { index, provider } = await createPair(FIXTURE, {
    cutPaths: ['sources/qualified.md'],
    exclude: ['sources/plain.md', 'parity/fence.md', 'assets/local.md'],
  });
  await assertParity(index, provider, FIXTURE);
});

test('positive edge cases reach notes/target.md: alias, heading, qualified, extension, embed, repeated, code fence', async () => {
  const { provider } = await createPair(FIXTURE);
  const backlinks = await provider.getBacklinks('notes/target.md');
  assert.deepEqual(backlinks, [
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

test('negative cases: mention without a link, same-stem link, ambiguous basename elsewhere, markdown link, self link', async () => {
  const { provider } = await createPair(FIXTURE);
  const targetSources = (await provider.getBacklinks('notes/target.md')).map((entry) => entry.file);
  assert.ok(!targetSources.includes('negatives/mention.md'), 'plain-text mention is not a backlink');
  assert.ok(!targetSources.includes('negatives/other-stem.md'), 'a link to a same-stem different file is not a backlink');

  assert.deepEqual((await provider.getBacklinks('other/target-notes.md')).map((entry) => entry.file), ['negatives/other-stem.md']);
  assert.deepEqual((await provider.getBacklinks('notes/target.png')).map((entry) => entry.file), ['negatives/other-stem.md']);

  // [[dup]] resolves to the first dup.md in workspace order (a/dup.md), never to b/dup.md.
  assert.deepEqual((await provider.getBacklinks('a/dup.md')).map((entry) => entry.file), ['negatives/dup-elsewhere.md']);
  assert.deepEqual((await provider.getBacklinks('b/dup.md')).map((entry) => entry.file), ['parity/dup-b.md']);

  assert.deepEqual(await provider.getBacklinks('x.md'), [], '[x](../x.md) is not a backlink in either mode');
  assert.deepEqual(await provider.getBacklinks('notes/self.md'), [], 'self links do not count');
});

test('non-markdown targets: wiki embeds and relative (also percent-encoded) image links are found', async () => {
  const { provider } = await createPair(FIXTURE);
  assert.deepEqual((await provider.getBacklinks('assets/img.png')).map((entry) => entry.file), [
    'assets/local.md',
    'sources/embeds.md',
    'sources/relative.md',
  ]);
  assert.deepEqual((await provider.getBacklinks('assets/my pic.png')).map((entry) => entry.file), ['sources/relative.md']);
  assert.deepEqual((await provider.getBacklinks('assets/diagram.excalidraw')).map((entry) => entry.file), ['sources/embeds.md']);
});

test('candidate literals: only keys that resolve to the target, minimal for a substring filter', () => {
  const files = ['a/dup.md', 'b/dup.md', 'notes/target.md', 'assets/my pic.png'];
  const wikiTargetIndex = createWikiTargetIndex(files);
  assert.deepEqual(buildCandidateLiterals('notes/target.md', wikiTargetIndex), ['target']);
  assert.deepEqual(buildCandidateLiterals('a/dup.md', wikiTargetIndex), ['dup']);
  // The bare stem resolves to a/dup.md, so b/dup.md is only reachable by a qualified key.
  assert.deepEqual(buildCandidateLiterals('b/dup.md', wikiTargetIndex), ['b/dup']);
  assert.deepEqual(buildCandidateLiterals('assets/my pic.png', wikiTargetIndex), ['my pic.png', 'my%20pic.png']);
  assert.deepEqual(buildCandidateLiterals('missing.md', wikiTargetIndex), []);
});

test('candidate query: parameterised, phrase + literal predicates, keyset-paged; no phrase for a token-less literal', () => {
  const query = buildCandidateQuery(['b/dup'], { afterPath: 'm.md', limit: 100 });
  assert.equal(
    query.text,
    'SELECT path, text FROM wisdom_docs WHERE (text ### $1::text) AND (strpos(text, $1::text) > 0) AND path > $2::text ORDER BY path LIMIT $3::int',
  );
  assert.deepEqual(query.values, ['b/dup', 'm.md', 100]);
  const tokenless = buildCandidateQuery(['+++'], {});
  assert.ok(!tokenless.text.includes('###'), 'a literal with no letter or digit would phrase-match nothing');
  assert.ok(tokenless.text.includes('strpos(text, $1::text) > 0'));
});

test('the store path-words line cannot create a reference (text is used as stored)', async () => {
  // A path whose words spell a link-like stem still yields only letters/digits/spaces.
  const files = [['target.md', '# t'], ['dir/target/note.md', 'no links here']];
  const { provider } = await createPair(files);
  assert.deepEqual(await provider.getBacklinks('target.md'), []);
});

test('paging: candidates beyond one page are all read, up to the cap, then a warning', async () => {
  const sources = Array.from({ length: 230 }, (_, index) => [`s/${String(index).padStart(3, '0')}.md`, 'See [[hub]].']);
  const files = [['hub.md', '# hub'], ...sources];
  const { index, provider, pg } = await createPair(files);
  assert.equal((await provider.getBacklinks('hub.md')).length, 230);
  assert.equal(JSON.stringify(await provider.getBacklinks('hub.md')), JSON.stringify(await index.getBacklinks('hub.md')));
  assert.ok(pg.queries.filter((query) => query.text.includes('###')).length >= 3, 'paged in pages of 100');

  const capped = await createPair(files, { providerOptions: { maxCandidates: 150 } });
  // The cap counts candidate ROWS: hub.md itself is the first one (its path-words line holds "hub"),
  // so 150 candidates confirm 149 backlinks.
  assert.equal((await capped.provider.getBacklinks('hub.md')).length, 149);
  assert.ok(capped.logger.lines.warn.some((line) => line.includes('candidate cap of 150')));
});

test('overlay: an edit through updateFile adds a backlink at once although the store still has the old text, and expires after the window', async () => {
  let now = 1_000_000;
  const files = [['target.md', '# t'], ['src.md', 'no link yet']];
  const { provider } = await createPair(files, { providerOptions: { now: () => now, overlayWindowMs: 60_000 } });
  assert.deepEqual(await provider.getBacklinks('target.md'), []);

  provider.updateFile('src.md', 'now [[target]]');
  assert.deepEqual(await provider.getBacklinks('target.md'), [{ file: 'src.md', contexts: ['now [[target]]'] }]);

  now += 60_001;
  assert.deepEqual(await provider.getBacklinks('target.md'), [], 'after the window the (old) store text decides again');
});

test('overlay: removing a link through updateFile removes the backlink although the store still has it', async () => {
  const files = [['target.md', '# t'], ['src.md', 'see [[target]]']];
  const { provider } = await createPair(files);
  assert.equal((await provider.getBacklinks('target.md')).length, 1);
  provider.updateFile('src.md', 'link removed');
  assert.deepEqual(await provider.getBacklinks('target.md'), []);
});

test('overlay: applyWorkspaceChange (an edit seen on disk) reads the changed file into the overlay', async () => {
  const files = [['target.md', '# t'], ['src.md', 'no link']];
  const { provider, vaultFileStore, workspaceState } = await createPair(files);
  vaultFileStore.files.set('src.md', 'disk edit [[target]]');
  await provider.applyWorkspaceChange({ changedPaths: ['src.md'] }, { nextState: workspaceState, previousState: workspaceState });
  assert.deepEqual(await provider.getBacklinks('target.md'), [{ file: 'src.md', contexts: ['disk edit [[target]]'] }]);
});

test('gap set: a file absent from the store is found via the gap index; only gap files are read from disk', async () => {
  const { provider, vaultFileStore } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  const sources = (await provider.getBacklinks('notes/target.md')).map((entry) => entry.file);
  assert.ok(sources.includes('sources/plain.md'));
  // No full-vault read: the startup reads were exactly the gap file.
  assert.deepEqual(vaultFileStore.reads, ['sources/plain.md']);
});

test('gap set: a document the store holds cut at its cap is served from disk, not from the cut text', async () => {
  const files = [['target.md', '# t'], ['big.md', 'see [[target]] (the store cut this one)']];
  const vaultFileStore = new StubVaultStore(files);
  const workspaceState = await vaultFileStore.scanWorkspaceState();
  // The store copy lost the link past its cap.
  const pg = new FakeDocsStore([['big.md', storeText('big.md', 'see')], ['target.md', storeText('target.md', '# t')]], { cutPaths: ['big.md'] });
  const provider = new PgBacklinkProvider({ logger: quietLogger(), pg, vaultFileStore });
  t_closeLater.push(provider);
  await provider.start({ workspaceState });
  assert.deepEqual((await provider.getBacklinks('target.md')).map((entry) => entry.file), ['big.md']);
  assert.ok(GAP_LIST_SQL.includes(`octet_length(text) >= ${STORE_TEXT_CAP_CHARS}`));
});

test('gap set: a file in both the gap index and the store results is listed once', async () => {
  const { pg, provider } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  // The store indexes the file after the gap refresh: both parts now hold it.
  pg.docs.set('sources/plain.md', storeText('sources/plain.md', FIXTURE.find(([path]) => path === 'sources/plain.md')[1]));
  const sources = (await provider.getBacklinks('notes/target.md')).map((entry) => entry.file);
  assert.equal(sources.filter((source) => source === 'sources/plain.md').length, 1);
});

test('gap set: the next refresh moves files between the gap index and the store without a full rebuild', async () => {
  const { pg, provider, vaultFileStore } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  pg.docs.set('sources/plain.md', storeText('sources/plain.md', 'Plain [[target]].'));
  pg.docs.delete('sources/alias.md');
  vaultFileStore.reads.length = 0;
  await provider.refreshGapSet();
  assert.deepEqual(vaultFileStore.reads, ['sources/alias.md']);
  const sources = (await provider.getBacklinks('notes/target.md')).map((entry) => entry.file);
  assert.ok(sources.includes('sources/alias.md') && sources.includes('sources/plain.md'));
});

test('degradation: Postgres throwing yields overlay + gap results, one warning across calls, no exception', async () => {
  const { logger, pg, provider } = await createPair(FIXTURE, { exclude: ['sources/plain.md'] });
  provider.updateFile('sources/alias.md', 'edited [[target]]');
  pg.failWith = new Error('connect ECONNREFUSED');
  const first = await provider.getBacklinks('notes/target.md');
  const second = await provider.getBacklinks('notes/target.md');
  assert.deepEqual(first.map((entry) => entry.file), ['sources/alias.md', 'sources/plain.md']);
  assert.deepEqual(second, first);
  assert.equal(logger.lines.warn.filter((line) => line.includes('Postgres unavailable')).length, 1);

  pg.failWith = null;
  assert.ok((await provider.getBacklinks('notes/target.md')).length > 2, 'recovers once Postgres answers');
  assert.ok(logger.lines.log.some((line) => line.includes('reachable again')));
});

test('degradation: a hanging Postgres query is cut at the timeout', async () => {
  const { pg, provider } = await createPair(FIXTURE, { providerOptions: { timeoutMs: 50 } });
  provider.updateFile('sources/alias.md', 'edited [[target]]');
  pg.hang = true;
  const startedAt = Date.now();
  const backlinks = await provider.getBacklinks('notes/target.md');
  assert.ok(Date.now() - startedAt < 2_000);
  assert.deepEqual(backlinks.map((entry) => entry.file), ['sources/alias.md']);
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
  assert.ok(hangingPg.queries.some((query) => query.text === GAP_LIST_SQL), 'the gap refresh started (and is still pending)');
  assert.equal(server.backlinkIndex._gapIndex, null, 'no gap index exists yet');
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
