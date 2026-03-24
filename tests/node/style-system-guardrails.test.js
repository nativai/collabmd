import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import postcss from 'postcss';

const repoRoot = process.cwd();
const clientRoot = resolve(repoRoot, 'src/client');
const clientStylesRoot = resolve(clientRoot, 'styles');
const appRoot = resolve(clientRoot, 'app');

const ALLOWED_RAW_COLOR_FILES = new Set([
  'src/client/styles/foundation/themes.css',
]);

async function collectFiles(dirPath, pattern) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, pattern));
      continue;
    }

    if (entry.isFile() && pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRepoPath(filePath) {
  return relative(repoRoot, filePath).replace(/\\/g, '/');
}

test('app html does not contain inline style blocks', async () => {
  const htmlFiles = await collectFiles(appRoot, /\.html$/u);
  const violations = [];

  for (const filePath of htmlFiles) {
    const source = await readFile(filePath, 'utf8');
    if (/<style(?:\s|>)/iu.test(source)) {
      violations.push(toRepoPath(filePath));
    }
  }

  assert.deepEqual(violations, []);
});

test('client source does not inject visual stylesheets at runtime', async () => {
  const sourceFiles = await collectFiles(clientRoot, /\.(?:js|mjs)$/u);
  const violations = [];

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, 'utf8');
    if (/createElement\((['"])style\1\)/u.test(source) || /style\.textContent\s*=\s*`/u.test(source)) {
      violations.push(toRepoPath(filePath));
    }
  }

  assert.deepEqual(violations, []);
});

test('raw hex and rgb colors live only in theme tokens', async () => {
  const cssFiles = await collectFiles(clientStylesRoot, /\.css$/u);
  const violations = [];

  for (const filePath of cssFiles) {
    const repoPath = toRepoPath(filePath);
    if (ALLOWED_RAW_COLOR_FILES.has(repoPath)) {
      continue;
    }

    const source = await readFile(filePath, 'utf8');
    if (/[#][0-9a-fA-F]{3,8}\b|rgba?\(/u.test(source)) {
      violations.push(repoPath);
    }
  }

  assert.deepEqual(violations, []);
});

test('client stylesheets parse without CSS syntax errors', async () => {
  const cssFiles = await collectFiles(clientStylesRoot, /\.css$/u);
  const violations = [];

  for (const filePath of cssFiles) {
    const source = await readFile(filePath, 'utf8');

    try {
      postcss.parse(source, { from: filePath });
    } catch (error) {
      violations.push({
        file: toRepoPath(filePath),
        reason: error.message,
      });
    }
  }

  assert.deepEqual(violations, []);
});

test('legacy button and input aliases are not used in client source', async () => {
  const sourceFiles = await collectFiles(clientRoot, /\.(?:js|mjs|html|css)$/u);
  const violations = [];

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, 'utf8');
    const repoPath = toRepoPath(filePath);
    const hasLegacyButtonAlias = /(['"])btn(?:-[a-z]+)?\1|\.btn(?:-[a-z]+)?\b/u.test(source);
    const hasLegacyInputAlias = /class(?:Name)?\s*=\s*['"][^'"]*(?:^|[\s])input(?:[\s]|['"])/u.test(source)
      || (repoPath.endsWith('.css') && /\.input\b/u.test(source));

    if (hasLegacyButtonAlias || hasLegacyInputAlias) {
      violations.push(repoPath);
    }
  }

  assert.deepEqual(violations, []);
});
