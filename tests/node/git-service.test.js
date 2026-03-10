import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { GitService } from '../../src/server/infrastructure/git/git-service.js';

const execFile = promisify(execFileCallback);

async function runGit(cwd, args) {
  await execFile('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_AUTHOR_NAME: 'CollabMD Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'CollabMD Tests',
    },
  });
}

async function createFixtureRepository() {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-'));

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  await writeFile(join(repoDir, 'tracked.md'), '# Tracked\n\nbase\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);

  await writeFile(join(repoDir, 'tracked.md'), '# Tracked\n\nbase\nupdated\n', 'utf8');
  await writeFile(join(repoDir, 'staged.md'), '# Staged\n\nready\n', 'utf8');
  await runGit(repoDir, ['add', 'staged.md']);
  await writeFile(join(repoDir, 'untracked.md'), '# Untracked\n\nscratch\n', 'utf8');

  return repoDir;
}

function createCountingExecFileImpl({ delayStatusMs = 0 } = {}) {
  const calls = [];

  return {
    calls,
    execFileImpl: async (...args) => {
      const [, gitArgs = []] = args;
      calls.push(gitArgs);
      if (delayStatusMs > 0 && gitArgs[0] === '-c' && gitArgs[2] === 'status') {
        await new Promise((resolve) => setTimeout(resolve, delayStatusMs));
      }
      return execFile(...args);
    },
  };
}

test('GitService reports sections and diffs for staged, unstaged, and untracked files', async (t) => {
  const repoDir = await createFixtureRepository();
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  const gitService = new GitService({ vaultDir: repoDir });
  const status = await gitService.getStatus({ force: true });

  assert.equal(status.isGitRepo, true);
  assert.equal(status.summary.staged, 1);
  assert.equal(status.summary.workingTree, 1);
  assert.equal(status.summary.untracked, 1);
  assert.equal(status.summary.additions > 0, true);

  const stagedFile = status.sections.find((section) => section.key === 'staged')?.files[0];
  const workingTreeFile = status.sections.find((section) => section.key === 'working-tree')?.files[0];
  const untrackedFile = status.sections.find((section) => section.key === 'untracked')?.files[0];

  assert.equal(stagedFile?.path, 'staged.md');
  assert.equal(stagedFile?.status, 'added');
  assert.equal(workingTreeFile?.path, 'tracked.md');
  assert.equal(workingTreeFile?.status, 'modified');
  assert.equal(untrackedFile?.path, 'untracked.md');
  assert.equal(untrackedFile?.status, 'untracked');

  const workingTreeDiff = await gitService.getDiff({ scope: 'working-tree' });
  assert.deepEqual(
    workingTreeDiff.files.map((file) => file.path).sort(),
    ['tracked.md', 'untracked.md'],
  );

  const stagedDiff = await gitService.getDiff({ scope: 'staged' });
  assert.deepEqual(stagedDiff.files.map((file) => file.path), ['staged.md']);
  assert.equal(stagedDiff.files[0].status, 'added');

  const fullDiff = await gitService.getDiff({ scope: 'all' });
  assert.deepEqual(
    fullDiff.files.map((file) => file.path).sort(),
    ['staged.md', 'tracked.md', 'untracked.md'],
  );
  assert.equal(fullDiff.summary.filesChanged, 3);

  const metaDiff = await gitService.getDiff({ metaOnly: true, scope: 'all' });
  assert.equal(metaDiff.metaOnly, true);
  assert.deepEqual(
    metaDiff.files.map((file) => file.path).sort(),
    ['staged.md', 'tracked.md', 'untracked.md'],
  );
  assert.equal(metaDiff.files.every((file) => !('hunks' in file)), true);
});

test('GitService normalizes git paths that include spaces', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-paths-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  const filePath = 'BFI - Biller/sample flow.puml';
  await mkdir(join(repoDir, 'BFI - Biller'), { recursive: true });
  await writeFile(join(repoDir, filePath), '@startuml\nAlice -> Bob\n@enduml\n', 'utf8');
  await runGit(repoDir, ['add', filePath]);
  await runGit(repoDir, ['commit', '-m', 'Add flow']);
  await writeFile(join(repoDir, filePath), '@startuml\nAlice -> Bob : updated\n@enduml\n', 'utf8');

  const gitService = new GitService({ vaultDir: repoDir });
  const status = await gitService.getStatus({ force: true });
  const changedFile = status.sections.find((section) => section.key === 'working-tree')?.files[0];

  assert.equal(changedFile?.path, filePath);

  const diff = await gitService.getDiff({ path: filePath, scope: 'working-tree' });
  assert.equal(diff.files.length, 1);
  assert.equal(diff.files[0].path, filePath);
});

test('GitService guards large file patches until explicitly requested', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-large-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  const largeContent = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n');
  await writeFile(join(repoDir, 'large.md'), `${largeContent}\n`, 'utf8');
  await runGit(repoDir, ['add', 'large.md']);
  await runGit(repoDir, ['commit', '-m', 'Add large file']);
  await writeFile(
    join(repoDir, 'large.md'),
    `${largeContent}\n${Array.from({ length: 80 }, (_, index) => `new line ${index + 1}`).join('\n')}\n`,
    'utf8',
  );

  const guardedCounter = createCountingExecFileImpl();
  const gitService = new GitService({
    execFileImpl: guardedCounter.execFileImpl,
    maxInitialPatchLines: 20,
    vaultDir: repoDir,
  });

  const guardedDiff = await gitService.getDiff({ path: 'large.md', scope: 'working-tree' });
  assert.equal(guardedDiff.files.length, 1);
  assert.equal(guardedDiff.files[0].tooLarge, true);
  assert.equal(guardedDiff.files[0].canLoadFullPatch, true);
  assert.deepEqual(guardedDiff.files[0].hunks, []);
  assert.equal(guardedCounter.calls.length, 3);
  assert.equal(
    guardedCounter.calls.some((args) => args[2] === 'diff' && !args.includes('--numstat')),
    false,
  );

  const fullCounter = createCountingExecFileImpl();
  const fullDiffService = new GitService({
    execFileImpl: fullCounter.execFileImpl,
    maxInitialPatchLines: 20,
    vaultDir: repoDir,
  });

  const fullDiff = await fullDiffService.getDiff({
    allowLargePatch: true,
    path: 'large.md',
    scope: 'working-tree',
  });
  assert.equal(fullDiff.files[0].tooLarge, false);
  assert.equal(fullDiff.files[0].hunks.length > 0, true);
  assert.equal(
    fullCounter.calls.some((args) => args[2] === 'diff' && !args.includes('--numstat')),
    true,
  );
});

test('GitService avoids redundant subprocesses for status and meta diff requests', async (t) => {
  const repoDir = await createFixtureRepository();
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  const statusCounter = createCountingExecFileImpl();
  const statusService = new GitService({
    execFileImpl: statusCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  await statusService.getStatus({ force: true });
  assert.equal(statusCounter.calls.length, 2);
  assert.equal(statusCounter.calls.some((args) => args.includes('rev-parse')), false);

  const diffCounter = createCountingExecFileImpl();
  const diffService = new GitService({
    execFileImpl: diffCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  const metaDiff = await diffService.getDiff({ metaOnly: true, scope: 'all' });
  assert.equal(metaDiff.summary.filesChanged, 3);
  assert.equal(diffCounter.calls.length, 3);
  assert.equal(diffCounter.calls.some((args) => args.includes('rev-parse')), false);
});

test('GitService coalesces concurrent status and diff requests', async (t) => {
  const repoDir = await createFixtureRepository();
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  const statusCounter = createCountingExecFileImpl({ delayStatusMs: 50 });
  const statusService = new GitService({
    execFileImpl: statusCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  const [firstStatus, secondStatus] = await Promise.all([
    statusService.getStatus({ force: true }),
    statusService.getStatus({ force: true }),
  ]);
  assert.equal(firstStatus.summary.changedFiles, secondStatus.summary.changedFiles);
  assert.equal(statusCounter.calls.length, 2);

  const diffCounter = createCountingExecFileImpl({ delayStatusMs: 50 });
  const diffService = new GitService({
    execFileImpl: diffCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  const [firstDiff, secondDiff] = await Promise.all([
    diffService.getDiff({ metaOnly: true, scope: 'all' }),
    diffService.getDiff({ metaOnly: true, scope: 'all' }),
  ]);
  assert.equal(firstDiff.summary.filesChanged, secondDiff.summary.filesChanged);
  assert.equal(diffCounter.calls.length, 3);
});

test('GitService stages, unstages, and commits all staged changes', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-actions-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'a.md'), '# A\n', 'utf8');
  await writeFile(join(repoDir, 'b.md'), '# B\n', 'utf8');
  await runGit(repoDir, ['add', 'a.md', 'b.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);

  await writeFile(join(repoDir, 'a.md'), '# A\nupdated\n', 'utf8');
  await writeFile(join(repoDir, 'b.md'), '# B\nstaged elsewhere\n', 'utf8');

  const gitService = new GitService({ vaultDir: repoDir });
  await gitService.stageFile('b.md');
  await gitService.stageFile('a.md');

  let status = await gitService.getStatus({ force: true });
  assert.equal(status.sections.find((section) => section.key === 'staged')?.files.length, 2);

  await gitService.unstageFile('a.md');
  status = await gitService.getStatus({ force: true });
  assert.equal(status.sections.find((section) => section.key === 'staged')?.files.map((file) => file.path).join(','), 'b.md');
  assert.equal(status.sections.find((section) => section.key === 'working-tree')?.files.map((file) => file.path).join(','), 'a.md');

  await gitService.stageFile('a.md');
  const commitResult = await gitService.commitStaged({
    message: 'Commit staged changes',
  });
  assert.equal(commitResult.commit.message, 'Commit staged changes');
  assert.equal(commitResult.commit.shortHash.length > 0, true);

  const headMessage = await execFile('git', ['log', '-1', '--pretty=%s'], { cwd: repoDir });
  assert.equal(String(headMessage.stdout).trim(), 'Commit staged changes');

  status = await gitService.getStatus({ force: true });
  assert.equal((status.sections.find((section) => section.key === 'staged')?.files ?? []).length, 0);
  assert.equal((status.sections.find((section) => section.key === 'working-tree')?.files ?? []).length, 0);
});

test('GitService pushes and pulls against an upstream branch', async (t) => {
  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-git-remote-'));
  const seedDir = await mkdtemp(join(tmpdir(), 'collabmd-git-seed-'));
  const localDir = await mkdtemp(join(tmpdir(), 'collabmd-git-local-'));
  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(seedDir, { force: true, recursive: true });
    await rm(localDir, { force: true, recursive: true });
  });

  await runGit(remoteDir, ['init', '--bare']);

  await runGit(seedDir, ['init']);
  await runGit(seedDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(seedDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(seedDir, 'test.md'), '# Seed\n', 'utf8');
  await runGit(seedDir, ['add', 'test.md']);
  await runGit(seedDir, ['commit', '-m', 'Initial commit']);
  await runGit(seedDir, ['remote', 'add', 'origin', remoteDir]);
  await runGit(seedDir, ['push', '-u', 'origin', 'master']);

  await runGit(tmpdir(), ['clone', remoteDir, localDir]);
  await runGit(localDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(localDir, ['config', 'user.name', 'CollabMD Tests']);

  const gitService = new GitService({ vaultDir: localDir });

  await writeFile(join(localDir, 'test.md'), '# Seed\nlocal change\n', 'utf8');
  await runGit(localDir, ['add', 'test.md']);
  await runGit(localDir, ['commit', '-m', 'Local commit']);
  await gitService.pushBranch();

  const remoteLog = await execFile('git', ['--git-dir', remoteDir, 'log', '-1', '--pretty=%s']);
  assert.equal(String(remoteLog.stdout).trim(), 'Local commit');

  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-git-peer-'));
  t.after(async () => {
    await rm(peerDir, { force: true, recursive: true });
  });
  await runGit(tmpdir(), ['clone', remoteDir, peerDir]);
  await runGit(peerDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(peerDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(peerDir, 'test.md'), '# Seed\nlocal change\npeer change\n', 'utf8');
  await runGit(peerDir, ['add', 'test.md']);
  await runGit(peerDir, ['commit', '-m', 'Peer commit']);
  await runGit(peerDir, ['push']);

  await gitService.pullBranch();

  const localContent = await execFile('git', ['show', 'HEAD:test.md'], { cwd: localDir });
  assert.match(String(localContent.stdout), /peer change/);
});
