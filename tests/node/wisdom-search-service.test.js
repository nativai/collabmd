import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  WisdomSearchService,
  slugifyEnginePath,
  buildSlugMap,
  parseEngineSnippetLines,
  locateSnippetInFile,
} from '../../src/server/domain/wisdom-search-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const realLexFixture = JSON.parse(
  readFileSync(join(here, 'fixtures/wisdom-engine-lex.json'), 'utf8'),
);

// --- slug rule (evidence cases from the path-mapping conception) ---

test('slugifyEnginePath reproduces the engine forward-slug rule', () => {
  assert.equal(
    slugifyEnginePath('Operating System/Projects/acpx-ui/tasks/features/wave-10/WAVE-B-CONCEPTION-SUMMARY.md'),
    'Operating-System/Projects/acpx-ui/tasks/features/wave-10/WAVE-B-CONCEPTION-SUMMARY.md',
  );
  assert.equal(slugifyEnginePath('Datenbanken/GelDb(fka EdgeDb).md'), 'Datenbanken/GelDb-fka-EdgeDb.md');
  assert.equal(slugifyEnginePath('Browser-Automation (for Enduser).md'), 'Browser-Automation-for-Enduser.md');
  assert.equal(
    slugifyEnginePath('AI Technology/Machine Learning Books & Learning Resources.md'),
    'AI-Technology/Machine-Learning-Books-Learning-Resources.md',
  );
  assert.equal(
    slugifyEnginePath('Frontend Design/How To ( AI Builder Space).md'),
    'Frontend-Design/How-To-AI-Builder-Space.md',
  );
});

test('slugifyEnginePath preserves case and the .md extension', () => {
  assert.equal(slugifyEnginePath('GelDb.md'), 'GelDb.md');
  assert.equal(slugifyEnginePath('a/b c.md'), 'a/b-c.md');
});

// --- slug map + collisions ---

test('buildSlugMap indexes markdown paths and skips non-markdown', () => {
  const map = buildSlugMap([
    'Datenbanken/GelDb(fka EdgeDb).md',
    'Foo/Bar.md',
    'image.png',
    'notes.txt',
  ]);
  assert.deepEqual(map.get('Datenbanken/GelDb-fka-EdgeDb.md'), ['Datenbanken/GelDb(fka EdgeDb).md']);
  assert.equal(map.has('Foo/Bar.md'), true);
  assert.equal([...map.keys()].some((k) => k.includes('image')), false);
  assert.equal([...map.keys()].some((k) => k.includes('notes')), false);
});

test('buildSlugMap groups colliding real paths under one slug', () => {
  const map = buildSlugMap(['Foo Bar.md', 'Foo-Bar.md', 'Foo(Bar).md']);
  assert.deepEqual(map.get('Foo-Bar.md').sort(), ['Foo Bar.md', 'Foo(Bar).md', 'Foo-Bar.md']);
});

// --- snippet parsing ---

test('parseEngineSnippetLines strips numeric prefixes and @@ hunk headers', () => {
  const lines = parseEngineSnippetLines(realLexFixture.results[0].snippet);
  assert.equal(lines.some((line) => line.includes('@@')), false, 'hunk header dropped');
  assert.equal(lines.some((line) => /^\s*\d+:/.test(line)), false, 'numeric prefixes stripped');
  // Content lines survive (real fixture: the Agent-Orchestrator note's body lines).
  assert.equal(lines.some((line) => line.trim().length > 0), true, 'content line preserved');
});

// --- in-file line location (true line, not the engine offset) ---

test('locateSnippetInFile emits the true file line + highlight offsets', () => {
  const content = [
    '# Heading',
    '',
    'unrelated line',
    '- [[Kagent]] - Kubernetes agent orchestrator',
    'trailing',
  ].join('\n');
  const located = locateSnippetInFile(
    content,
    ['- [[Kagent]] - Kubernetes agent orchestrator'],
    ['kagent'],
  );
  assert.equal(located.line, 4);
  assert.equal(located.column, 5);
  assert.equal(content.split('\n')[located.line - 1].slice(located.matchStart, located.matchEnd).toLowerCase(), 'kagent');
});

test('locateSnippetInFile falls back to line:null for a pure semantic hit', () => {
  const content = 'alpha\nbeta\ngamma';
  const located = locateSnippetInFile(content, ['nowhere in the file'], ['nomatch']);
  assert.equal(located.line, null);
  assert.equal(located.matchStart, 0);
  assert.equal(located.matchEnd, 0);
});

// --- mode branching (the progressive contract) ---

function recordingFetch(response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ body: JSON.parse(options.body), url });
    return { json: async () => response, ok: true, status: 200 };
  };
  return { calls, fetchImpl };
}

test('search(mode=lex) sends a lex-only engine request; mode=full sends vec+lex', async () => {
  const lex = recordingFetch({ results: [] });
  const lexService = new WisdomSearchService({ fetchImpl: lex.fetchImpl, getVaultFilePaths: () => [] });
  await lexService.search({ mode: 'lex', query: 'hello world' });
  assert.deepEqual(lex.calls[0].body.searches.map((s) => s.type), ['lex']);
  assert.deepEqual(lex.calls[0].body.collections, ['brain']);
  assert.equal(lex.calls[0].body.searches[0].query, 'hello world');

  const full = recordingFetch({ results: [] });
  const fullService = new WisdomSearchService({ fetchImpl: full.fetchImpl, getVaultFilePaths: () => [] });
  await fullService.search({ mode: 'full', query: 'hello world' });
  assert.deepEqual(full.calls[0].body.searches.map((s) => s.type), ['vec', 'lex']);

  const dflt = recordingFetch({ results: [] });
  const dfltService = new WisdomSearchService({ fetchImpl: dflt.fetchImpl, getVaultFilePaths: () => [] });
  await dfltService.search({ query: 'hello world' });
  assert.deepEqual(dflt.calls[0].body.searches.map((s) => s.type), ['vec', 'lex'], 'defaults to full');
});

test('search enforces minQueryLength and never calls the engine for short queries', async () => {
  const rec = recordingFetch({ results: [] });
  const service = new WisdomSearchService({ fetchImpl: rec.fetchImpl, getVaultFilePaths: () => [] });
  const result = await service.search({ query: 'a' });
  assert.equal(rec.calls.length, 0);
  assert.deepEqual(result.files, []);
  assert.equal(result.ok, true);
});

// --- full transform against a temp vault (resolved paths + true lines + identical shape) ---

test('search resolves engine slugs to real vault paths and returns the ripgrep shape', async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'wisdom-test-'));
  try {
    await mkdir(join(vaultDir, 'Datenbanken'), { recursive: true });
    await writeFile(
      join(vaultDir, 'Datenbanken/GelDb(fka EdgeDb).md'),
      '# GelDb\n\nThis note describes the GelDb graph database engine.\n',
      'utf8',
    );

    const engineResponse = {
      results: [
        {
          docid: '#a1',
          file: 'brain/Datenbanken/GelDb-fka-EdgeDb.md',
          score: 0.9,
          snippet: '2: @@ -1,3 @@ (0 before, 1 after)\n3: This note describes the GelDb graph database engine.',
          title: 'GelDb',
        },
      ],
    };
    const rec = recordingFetch(engineResponse);
    const service = new WisdomSearchService({
      fetchImpl: rec.fetchImpl,
      getVaultFilePaths: () => ['Datenbanken/GelDb(fka EdgeDb).md'],
      vaultDir,
    });

    const result = await service.search({ mode: 'full', query: 'GelDb database' });
    assert.equal(result.backend, 'wisdom');
    assert.equal(result.ok, true);
    assert.equal(result.files.length, 1);
    // The openable path is the REAL vault path (special chars intact), not the slug.
    assert.equal(result.files[0].file, 'Datenbanken/GelDb(fka EdgeDb).md');
    assert.equal(result.files[0].unresolvable, undefined);
    const snippet = result.files[0].snippets[0];
    assert.equal(snippet.line, 3, 'true file line, not the engine offset');
    assert.equal(result.search.backend, 'wisdom');
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
});

test('search marks an unresolvable hit (slug maps to no vault file) and never fabricates a path', async () => {
  const rec = recordingFetch({
    results: [
      {
        docid: '#gone',
        file: 'brain/Deleted/Ghost-File.md',
        score: 0.7,
        snippet: '5: @@ -4,1 @@\n6: some content from a since-deleted file',
        title: 'Ghost',
      },
    ],
  });
  const service = new WisdomSearchService({
    fetchImpl: rec.fetchImpl,
    getVaultFilePaths: () => ['Existing/Real.md'],
    vaultDir: '/nonexistent',
  });
  const result = await service.search({ mode: 'full', query: 'ghost content' });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].unresolvable, true);
  assert.notEqual(result.files[0].file, 'brain/Deleted/Ghost-File.md');
});

// --- graceful degrade: engine error never leaks; plain message + unavailable config ---

test('search degrades cleanly when the engine errors (no raw leak)', async () => {
  const service = new WisdomSearchService({
    fetchImpl: async () => { throw new Error('ECONNREFUSED 10.1.2.3:8181 raw stack detail'); },
    getVaultFilePaths: () => [],
  });
  await assert.rejects(
    service.search({ mode: 'full', query: 'anything here' }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.doesNotMatch(error.message, /ECONNREFUSED|stack|10\.1\.2\.3/, 'no raw engine detail leaks');
      assert.equal(error.search.available, false);
      assert.equal(error.search.backend, 'wisdom');
      return true;
    },
  );
});

test('search reports a timeout distinctly (504) with a plain message', async () => {
  const service = new WisdomSearchService({
    fetchImpl: async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    },
    getVaultFilePaths: () => [],
  });
  await assert.rejects(
    service.search({ mode: 'lex', query: 'anything here' }),
    (error) => {
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /too long/i);
      return true;
    },
  );
});
