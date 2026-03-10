import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const STATUS_MAP = {
  A: { code: 'A', label: 'added', status: 'added' },
  C: { code: 'C', label: 'copied', status: 'copied' },
  D: { code: 'D', label: 'deleted', status: 'deleted' },
  M: { code: 'M', label: 'modified', status: 'modified' },
  R: { code: 'R', label: 'renamed', status: 'renamed' },
  T: { code: 'T', label: 'type change', status: 'type-changed' },
  U: { code: 'U', label: 'conflicted', status: 'conflicted' },
  '?': { code: 'U', label: 'untracked', status: 'untracked' },
};

function createStatusInfo(symbol) {
  return STATUS_MAP[symbol] ?? { code: symbol || 'M', label: 'modified', status: 'modified' };
}

function createRequestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function decodeQuotedPath(pathValue) {
  const rawValue = String(pathValue ?? '').trim();
  if (!(rawValue.startsWith('"') && rawValue.endsWith('"'))) {
    return rawValue;
  }

  return rawValue
    .slice(1, -1)
    .replace(/\\([\\"])/g, '$1')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\([0-7]{3})/g, (_match, value) => String.fromCharCode(Number.parseInt(value, 8)));
}

function normalizeRelativePath(pathValue) {
  const normalized = decodeQuotedPath(pathValue)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/u, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw createRequestError(400, 'Missing path parameter');
  }

  if (normalized.some((segment) => segment === '.' || segment === '..')) {
    throw createRequestError(400, 'Invalid path parameter');
  }

  return normalized.join('/');
}

function parseRenamePath(rawPath) {
  const decodedPath = decodeQuotedPath(rawPath);
  const separator = ' -> ';
  const separatorIndex = decodedPath.indexOf(separator);
  if (separatorIndex === -1) {
    return {
      oldPath: null,
      path: decodedPath,
    };
  }

  return {
    oldPath: decodedPath.slice(0, separatorIndex),
    path: decodedPath.slice(separatorIndex + separator.length),
  };
}

function parseBranchLine(line) {
  const result = {
    ahead: 0,
    behind: 0,
    detached: false,
    hasCommits: true,
    name: null,
    upstream: null,
  };

  if (!line.startsWith('## ')) {
    return result;
  }

  const branchText = line.slice(3).trim();
  if (!branchText) {
    return result;
  }

  if (branchText.startsWith('No commits yet on ')) {
    result.name = branchText.slice('No commits yet on '.length);
    result.hasCommits = false;
    return result;
  }

  if (branchText.startsWith('HEAD (no branch)')) {
    result.name = 'HEAD';
    result.detached = true;
    return result;
  }

  const metadataIndex = branchText.indexOf(' [');
  const branchSegment = metadataIndex === -1
    ? branchText
    : branchText.slice(0, metadataIndex);
  const metadataSegment = metadataIndex === -1
    ? ''
    : branchText.slice(metadataIndex + 2, -1);
  const [name, upstream] = branchSegment.split('...');

  result.name = name || null;
  result.upstream = upstream || null;

  if (metadataSegment) {
    for (const token of metadataSegment.split(',')) {
      const value = token.trim();
      if (value.startsWith('ahead ')) {
        result.ahead = Number.parseInt(value.slice(6), 10) || 0;
      } else if (value.startsWith('behind ')) {
        result.behind = Number.parseInt(value.slice(7), 10) || 0;
      }
    }
  }

  return result;
}

function parseStatusOutput(output) {
  const lines = String(output ?? '')
    .split(/\r?\n/u)
    .filter(Boolean);
  const [branchLine = '', ...statusLines] = lines;
  const branch = parseBranchLine(branchLine);
  const sections = {
    staged: [],
    'working-tree': [],
    untracked: [],
  };
  const uniquePaths = new Set();

  for (const line of statusLines) {
    if (line.length < 3) {
      continue;
    }

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const rawPath = line.slice(3);

    if (indexStatus === '!' && workTreeStatus === '!') {
      continue;
    }

    if (indexStatus === '?' && workTreeStatus === '?') {
      const file = {
        ...createStatusInfo('?'),
        oldPath: null,
        path: decodeQuotedPath(rawPath),
        scope: 'untracked',
      };
      sections.untracked.push(file);
      uniquePaths.add(file.path);
      continue;
    }

    const parsedPath = parseRenamePath(rawPath);

    if (indexStatus !== ' ') {
      const file = {
        ...createStatusInfo(indexStatus),
        oldPath: parsedPath.oldPath,
        path: parsedPath.path,
        scope: 'staged',
      };
      sections.staged.push(file);
      uniquePaths.add(file.path);
    }

    if (workTreeStatus !== ' ') {
      const file = {
        ...createStatusInfo(workTreeStatus),
        oldPath: parsedPath.oldPath,
        path: parsedPath.path,
        scope: 'working-tree',
      };
      sections['working-tree'].push(file);
      uniquePaths.add(file.path);
    }
  }

  return {
    branch,
    sections,
    summary: {
      changedFiles: uniquePaths.size,
      staged: sections.staged.length,
      untracked: sections.untracked.length,
      workingTree: sections['working-tree'].length,
    },
  };
}

function stripDiffPrefix(pathValue) {
  const normalizedPath = String(pathValue ?? '').replace(/\s+$/u, '');
  if (!normalizedPath || normalizedPath === '/dev/null') {
    return null;
  }

  if (normalizedPath.startsWith('a/') || normalizedPath.startsWith('b/')) {
    return normalizedPath.slice(2);
  }

  return normalizedPath;
}

function parseHunkHeader(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u);
  if (!match) {
    return null;
  }

  return {
    header: line,
    newLines: Number.parseInt(match[4] ?? '1', 10),
    newStart: Number.parseInt(match[3], 10),
    oldLines: Number.parseInt(match[2] ?? '1', 10),
    oldStart: Number.parseInt(match[1], 10),
    section: match[5]?.trim() || '',
  };
}

function finalizeFile(file) {
  if (!file) {
    return null;
  }

  if (file.oldPath === file.path) {
    file.oldPath = null;
  }

  return file;
}

function splitContentLines(content) {
  const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function parseNumstatOutput(output) {
  return String(output ?? '')
    .split(/\r?\n/u)
    .filter(Boolean)
    .reduce((summary, line) => {
      const [rawAdditions = '0', rawDeletions = '0'] = line.split('\t');
      const additions = rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions, 10) || 0;
      const deletions = rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions, 10) || 0;

      return {
        additions: summary.additions + additions,
        deletions: summary.deletions + deletions,
      };
    }, {
      additions: 0,
      deletions: 0,
    });
}

function parseNumstatEntries(output) {
  return String(output ?? '')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [rawAdditions = '0', rawDeletions = '0', ...rest] = line.split('\t');
      return {
        additions: rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions, 10) || 0,
        deletions: rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions, 10) || 0,
        rawPath: rest.join('\t'),
      };
    });
}

function getStatusPriority(status) {
  switch (status) {
    case 'deleted':
      return 5;
    case 'added':
    case 'untracked':
      return 4;
    case 'renamed':
      return 3;
    default:
      return 2;
  }
}

function createScopeFlags(scope) {
  return {
    hasStagedChanges: scope === 'staged',
    hasUntrackedChanges: scope === 'untracked',
    hasWorkingTreeChanges: scope === 'working-tree',
  };
}

function mergeScopedFile(existingFile, nextFile, scope) {
  const nextFlags = createScopeFlags(nextFile.scope);
  if (!existingFile) {
    return {
      ...nextFile,
      ...nextFlags,
      scope,
      stats: {
        additions: 0,
        deletions: 0,
      },
    };
  }

  const nextPriority = getStatusPriority(nextFile.status);
  const currentPriority = getStatusPriority(existingFile.status);
  if (nextPriority > currentPriority) {
    return {
      ...existingFile,
      ...nextFile,
      hasStagedChanges: existingFile.hasStagedChanges || nextFlags.hasStagedChanges,
      hasUntrackedChanges: existingFile.hasUntrackedChanges || nextFlags.hasUntrackedChanges,
      hasWorkingTreeChanges: existingFile.hasWorkingTreeChanges || nextFlags.hasWorkingTreeChanges,
      scope,
      stats: existingFile.stats ?? {
        additions: 0,
        deletions: 0,
      },
    };
  }

  return {
    ...existingFile,
    hasStagedChanges: existingFile.hasStagedChanges || nextFlags.hasStagedChanges,
    hasUntrackedChanges: existingFile.hasUntrackedChanges || nextFlags.hasUntrackedChanges,
    hasWorkingTreeChanges: existingFile.hasWorkingTreeChanges || nextFlags.hasWorkingTreeChanges,
  };
}

function countPatchLines(file = null) {
  return (file?.hunks ?? []).reduce((total, hunk) => total + (hunk.lines?.length ?? 0), 0);
}

function parseUnifiedDiff(diffText) {
  if (!diffText) {
    return [];
  }

  const files = [];
  const lines = String(diffText).split(/\r?\n/u);
  let currentFile = null;
  let currentHunk = null;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const parts = line.split(' ');
      const oldPath = stripDiffPrefix(parts[2]);
      const newPath = stripDiffPrefix(parts[3]);
      currentFile = {
        code: 'M',
        hunks: [],
        isBinary: false,
        oldPath,
        path: newPath ?? oldPath,
        stats: {
          additions: 0,
          deletions: 0,
        },
        status: 'modified',
      };
      currentHunk = null;
      files.push(currentFile);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith('new file mode ')) {
      currentFile.code = 'A';
      currentFile.status = 'added';
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      currentFile.code = 'D';
      currentFile.status = 'deleted';
      continue;
    }

    if (line.startsWith('rename from ')) {
      currentFile.code = 'R';
      currentFile.status = 'renamed';
      currentFile.oldPath = line.slice('rename from '.length);
      continue;
    }

    if (line.startsWith('rename to ')) {
      currentFile.path = line.slice('rename to '.length);
      continue;
    }

    if (line.startsWith('copy from ')) {
      currentFile.code = 'C';
      currentFile.status = 'copied';
      currentFile.oldPath = line.slice('copy from '.length);
      continue;
    }

    if (line.startsWith('copy to ')) {
      currentFile.path = line.slice('copy to '.length);
      continue;
    }

    if (line.startsWith('Binary files ')) {
      currentFile.isBinary = true;
      currentFile.binaryMessage = line;
      continue;
    }

    if (line.startsWith('--- ')) {
      currentFile.oldPath = stripDiffPrefix(line.slice(4));
      continue;
    }

    if (line.startsWith('+++ ')) {
      currentFile.path = stripDiffPrefix(line.slice(4)) ?? currentFile.path;
      continue;
    }

    const hunk = parseHunkHeader(line);
    if (hunk) {
      currentHunk = {
        ...hunk,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      oldLineNumber = hunk.oldStart;
      newLineNumber = hunk.newStart;
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    const prefix = line[0];
    const content = line.slice(1);

    if (prefix === ' ') {
      currentHunk.lines.push({
        content,
        newLine: newLineNumber,
        oldLine: oldLineNumber,
        type: 'context',
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    if (prefix === '-') {
      currentFile.stats.deletions += 1;
      currentHunk.lines.push({
        content,
        newLine: null,
        oldLine: oldLineNumber,
        type: 'deletion',
      });
      oldLineNumber += 1;
      continue;
    }

    if (prefix === '+') {
      currentFile.stats.additions += 1;
      currentHunk.lines.push({
        content,
        newLine: newLineNumber,
        oldLine: null,
        type: 'addition',
      });
      newLineNumber += 1;
      continue;
    }

    if (prefix === '\\') {
      currentHunk.lines.push({
        content: line,
        newLine: null,
        oldLine: null,
        type: 'note',
      });
    }
  }

  return files
    .map((file) => finalizeFile(file))
    .filter(Boolean);
}

function buildSyntheticAddedFileDiff(pathValue, content) {
  const normalizedContent = String(content ?? '').replace(/\r\n/g, '\n');
  const file = {
    code: 'U',
    hunks: [],
    isBinary: false,
    oldPath: null,
    path: pathValue,
    stats: {
      additions: 0,
      deletions: 0,
    },
    status: 'untracked',
    synthetic: true,
  };
  const lines = splitContentLines(normalizedContent);

  if (lines.length === 0) {
    return file;
  }

  file.stats.additions = lines.length;
  file.hunks.push({
    header: `@@ -0,0 +1,${lines.length} @@`,
    lines: lines.map((line, index) => ({
      content: line,
      newLine: index + 1,
      oldLine: null,
      type: 'addition',
    })),
    newLines: lines.length,
    newStart: 1,
    oldLines: 0,
    oldStart: 0,
    section: '',
  });

  return file;
}

export class GitService {
  constructor({
    enabled = true,
    execFileImpl = execFile,
    maxInitialPatchBytes = 250_000,
    maxInitialPatchLines = 1_500,
    statusCacheTtlMs = 2_000,
    vaultDir,
  }) {
    this.enabled = enabled;
    this.execFileImpl = execFileImpl;
    this.maxInitialPatchBytes = maxInitialPatchBytes;
    this.maxInitialPatchLines = maxInitialPatchLines;
    this.statusCacheTtlMs = statusCacheTtlMs;
    this.vaultDir = vaultDir;
    this.statusCache = {
      expiresAt: 0,
      value: null,
    };
  }

  async isGitRepo() {
    if (!this.enabled) {
      return false;
    }

    try {
      await access(join(this.vaultDir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  async execGit(args) {
    const result = await this.execFileImpl('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: this.vaultDir,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 10_000,
    });

    return String(result.stdout ?? '');
  }

  invalidateStatusCache() {
    this.statusCache = {
      expiresAt: 0,
      value: null,
    };
  }

  async getStatus({ force = false } = {}) {
    const isGitRepo = await this.isGitRepo();
    if (!isGitRepo) {
      return {
        branch: {
          ahead: 0,
          behind: 0,
          detached: false,
          hasCommits: false,
          name: null,
          upstream: null,
        },
        isGitRepo: false,
        sections: [
          { files: [], key: 'staged', label: 'Staged Changes' },
          { files: [], key: 'working-tree', label: 'Changes' },
          { files: [], key: 'untracked', label: 'Untracked' },
        ],
        summary: {
          additions: 0,
          changedFiles: 0,
          deletions: 0,
          staged: 0,
          untracked: 0,
          workingTree: 0,
        },
      };
    }

    const now = Date.now();
    if (!force && this.statusCache.value && now < this.statusCache.expiresAt) {
      return this.statusCache.value;
    }

    const parsed = parseStatusOutput(
      await this.execGit(['status', '--porcelain=v1', '--branch', '--untracked-files=all']),
    );
    const sections = [
      { files: parsed.sections.staged, key: 'staged', label: 'Staged Changes' },
      { files: parsed.sections['working-tree'], key: 'working-tree', label: 'Changes' },
      { files: parsed.sections.untracked, key: 'untracked', label: 'Untracked' },
    ];
    const localSummary = await this.getLocalChangeSummary(sections);
    const response = {
      branch: parsed.branch,
      isGitRepo: true,
      sections,
      summary: {
        ...parsed.summary,
        additions: localSummary.additions,
        deletions: localSummary.deletions,
      },
    };

    this.statusCache = {
      expiresAt: now + this.statusCacheTtlMs,
      value: response,
    };

    return response;
  }

  async hasHeadCommit() {
    try {
      await this.execGit(['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  async stageFile(path) {
    const normalizedPath = normalizeRelativePath(path);
    await this.execGit(['add', '-A', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
    };
  }

  async unstageFile(path) {
    const normalizedPath = normalizeRelativePath(path);
    await this.execGit(['reset', 'HEAD', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
    };
  }

  async commitStaged({ message } = {}) {
    const normalizedMessage = String(message ?? '').trim();
    if (!normalizedMessage) {
      throw createRequestError(400, 'Missing commit message');
    }

    const status = await this.getStatus({ force: true });
    if (Number(status.summary?.staged || 0) === 0) {
      throw createRequestError(409, 'No staged changes to commit');
    }

    await this.execGit(['commit', '-m', normalizedMessage]);
    const hash = (await this.execGit(['rev-parse', 'HEAD'])).trim();
    const shortHash = (await this.execGit(['rev-parse', '--short', 'HEAD'])).trim();
    this.invalidateStatusCache();
    return {
      commit: {
        hash,
        message: normalizedMessage,
        shortHash,
      },
      ok: true,
    };
  }

  async getLocalChangeSummary(sections = []) {
    const hasHeadCommit = await this.hasHeadCommit();
    const trackedSummary = parseNumstatOutput(
      await this.execGit(hasHeadCommit
        ? ['diff', '--numstat', 'HEAD']
        : ['diff', '--cached', '--numstat']),
    );
    const untrackedFiles = sections.find((section) => section.key === 'untracked')?.files ?? [];
    let untrackedAdditions = 0;

    for (const file of untrackedFiles) {
      try {
        const content = await readFile(join(this.vaultDir, file.path), 'utf8');
        untrackedAdditions += splitContentLines(content).length;
      } catch {
        // Ignore disappearing files between status refreshes.
      }
    }

    return {
      additions: trackedSummary.additions + untrackedAdditions,
      deletions: trackedSummary.deletions,
    };
  }

  async buildDiffCommandArgs({ numstat = false, path = null, scope = 'working-tree' } = {}) {
    const args = numstat
      ? ['diff', '--numstat']
      : ['diff', '--no-color', '--no-ext-diff', '--find-renames'];

    if (scope === 'staged') {
      args.push('--cached');
    } else if (scope === 'all') {
      if (await this.hasHeadCommit()) {
        args.push('HEAD');
      } else {
        args.push('--cached');
      }
    }

    if (path) {
      args.push('--', path);
    }

    return args;
  }

  getScopedFiles(status, scope = 'working-tree', path = null) {
    const orderedFiles = [];
    const fileMap = new Map();
    const candidateSections = scope === 'staged'
      ? ['staged']
      : scope === 'all'
        ? ['staged', 'working-tree', 'untracked']
        : ['working-tree', 'untracked'];

    for (const sectionKey of candidateSections) {
      const section = status.sections.find((entry) => entry.key === sectionKey);
      for (const file of section?.files ?? []) {
        if (path && file.path !== path) {
          continue;
        }

        if (!fileMap.has(file.path)) {
          const merged = mergeScopedFile(null, file, scope);
          fileMap.set(file.path, merged);
          orderedFiles.push(merged);
          continue;
        }

        const merged = mergeScopedFile(fileMap.get(file.path), file, scope);
        fileMap.set(file.path, merged);
        const index = orderedFiles.findIndex((entry) => entry.path === file.path);
        if (index >= 0) {
          orderedFiles[index] = merged;
        }
      }
    }

    return orderedFiles;
  }

  async getScopeSummary({ files = [], path = null, scope = 'working-tree' } = {}) {
    const trackedSummary = parseNumstatOutput(
      await this.execGit(await this.buildDiffCommandArgs({
        numstat: true,
        path,
        scope,
      })),
    );
    let untrackedAdditions = 0;

    for (const file of files.filter((entry) => entry.status === 'untracked')) {
      try {
        const content = await readFile(join(this.vaultDir, file.path), 'utf8');
        untrackedAdditions += splitContentLines(content).length;
      } catch {
        // Ignore disappearing files between requests.
      }
    }

    return {
      additions: trackedSummary.additions + untrackedAdditions,
      deletions: trackedSummary.deletions,
      filesChanged: files.length,
    };
  }

  async getDiff({ allowLargePatch = false, metaOnly = false, path = null, scope = 'working-tree' } = {}) {
    const isGitRepo = await this.isGitRepo();
    if (!isGitRepo) {
      return {
        files: [],
        isGitRepo: false,
        metaOnly,
        scope,
        summary: {
          additions: 0,
          deletions: 0,
          filesChanged: 0,
        },
      };
    }

    const normalizedPath = path ? normalizeRelativePath(path) : null;
    const resolvedScope = scope === 'staged' || scope === 'all'
      ? scope
      : 'working-tree';
    const status = await this.getStatus();
    const scopedFiles = this.getScopedFiles(status, resolvedScope, normalizedPath);
    const scopeSummary = await this.getScopeSummary({
      files: scopedFiles,
      path: normalizedPath,
      scope: resolvedScope,
    });

    if (metaOnly) {
      return {
        files: scopedFiles,
        isGitRepo: true,
        metaOnly: true,
        path: normalizedPath,
        scope: resolvedScope,
        summary: scopeSummary,
      };
    }

    const diffText = await this.execGit(await this.buildDiffCommandArgs({
      path: normalizedPath,
      scope: resolvedScope,
    }));
    const parsedFiles = parseUnifiedDiff(diffText);

    if (resolvedScope !== 'staged') {
      const untrackedFiles = status.sections
        .find((section) => section.key === 'untracked')
        ?.files
        ?.filter((file) => !normalizedPath || file.path === normalizedPath)
        ?? [];

      for (const file of untrackedFiles) {
        if (parsedFiles.some((entry) => entry.path === file.path)) {
          continue;
        }

        const content = await readFile(join(this.vaultDir, file.path), 'utf8');
        parsedFiles.push(buildSyntheticAddedFileDiff(file.path, content));
      }
    }

    const mergedFiles = scopedFiles.map((file) => {
      const detail = parsedFiles.find((entry) => entry.path === file.path) ?? null;
      if (!detail) {
        return {
          ...file,
          hunks: [],
          stats: file.stats ?? {
            additions: 0,
            deletions: 0,
          },
        };
      }

      const patchLineCount = countPatchLines(detail);
      if (
        normalizedPath
        && !allowLargePatch
        && (
          patchLineCount > this.maxInitialPatchLines
          || diffText.length > this.maxInitialPatchBytes
        )
      ) {
        return {
          ...file,
          byteLength: diffText.length,
          canLoadFullPatch: true,
          hunks: [],
          patchLineCount,
          stats: detail.stats,
          tooLarge: true,
        };
      }

      return {
        ...file,
        ...detail,
        canLoadFullPatch: false,
        patchLineCount,
        tooLarge: false,
      };
    });

    const summary = parsedFiles.reduce((accumulator, file) => ({
      additions: accumulator.additions + (file.stats?.additions ?? 0),
      deletions: accumulator.deletions + (file.stats?.deletions ?? 0),
      filesChanged: accumulator.filesChanged + 1,
    }), {
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    });

    return {
      files: mergedFiles,
      isGitRepo: true,
      metaOnly: false,
      path: normalizedPath,
      scope: resolvedScope,
      summary: normalizedPath ? summary : scopeSummary,
    };
  }
}
