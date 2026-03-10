import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const repoRoot = process.cwd();
const srcRoot = resolve(repoRoot, 'src');

const RELATIVE_IMPORT_PATTERN = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const RULES = [
  {
    name: 'shared-domain-isolated',
    appliesTo: 'src/domain/',
    forbidden: ['src/client/', 'src/server/'],
  },
  {
    name: 'client-presentation-no-upward-deps',
    appliesTo: 'src/client/presentation/',
    forbidden: ['src/client/application/', 'src/client/infrastructure/'],
  },
  {
    name: 'client-infrastructure-no-ui-deps',
    appliesTo: 'src/client/infrastructure/',
    forbidden: ['src/client/application/', 'src/client/presentation/'],
  },
  {
    name: 'client-application-no-adapter-imports',
    appliesTo: 'src/client/application/',
    forbidden: ['src/client/presentation/', 'src/client/infrastructure/'],
    allowFiles: new Set([
      'src/client/application/collabmd-app.js',
    ]),
  },
  {
    name: 'server-domain-no-infrastructure',
    appliesTo: 'src/server/domain/',
    forbidden: ['src/server/infrastructure/'],
  },
  {
    name: 'server-auth-no-infrastructure',
    appliesTo: 'src/server/auth/',
    forbidden: ['src/server/infrastructure/'],
    allowFiles: new Set([
      'src/server/auth/create-auth-service.js',
    ]),
  },
];

async function collectFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRepoPath(filePath) {
  return relative(repoRoot, filePath).replace(/\\/g, '/');
}

function extractRelativeSpecifiers(source) {
  const specifiers = [];

  for (const pattern of [RELATIVE_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith('.')) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

function resolveImport(fromFile, specifier) {
  return resolve(dirname(fromFile), specifier);
}

function matchesPrefix(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

test('source files respect architecture boundary rules', async () => {
  const files = await collectFiles(srcRoot);
  const violations = [];

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const source = await readFile(filePath, 'utf8');
    const specifiers = extractRelativeSpecifiers(source);

    for (const specifier of specifiers) {
      const targetRepoPath = toRepoPath(resolveImport(filePath, specifier));
      if (!targetRepoPath.startsWith('src/')) {
        continue;
      }

      for (const rule of RULES) {
        if (!repoPath.startsWith(rule.appliesTo)) {
          continue;
        }

        if (rule.allowFiles?.has(repoPath)) {
          continue;
        }

        if (matchesPrefix(targetRepoPath, rule.forbidden)) {
          violations.push(`${rule.name}: ${repoPath} -> ${targetRepoPath}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});
