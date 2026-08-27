import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 2;
const commitMessage = process.env.PUBLISH_COMMIT_MESSAGE ?? 'Publish report artifacts';

function runGitAt(cwd, args, options = {}) {
  const output = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  return output ? output.toString().trim() : '';
}

function runGit(args, options = {}) {
  return runGitAt(repoRoot, args, options);
}

function normalizePaths(values) {
  const paths = values.map((value) => {
    const absolutePath = path.resolve(repoRoot, value);
    const relativePath = path.relative(repoRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`publish_path_outside_repository:${value}`);
    }
    return relativePath;
  });
  if (!paths.length) throw new Error('publish_paths_required');
  return [...new Set(paths)];
}

function preserveGeneratedFiles(paths) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-publish-'));
  try {
    for (const relativePath of paths) {
      const sourcePath = path.join(repoRoot, relativePath);
      if (!fs.existsSync(sourcePath)) throw new Error(`publish_artifact_missing:${relativePath}`);
      const targetPath = path.join(tempDir, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
    return tempDir;
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function restoreGeneratedFiles(tempDir, paths, targetRoot = repoRoot) {
  for (const relativePath of paths) {
    const sourcePath = path.join(tempDir, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function remoteMainSha() {
  const output = runGit(['ls-remote', 'origin', 'refs/heads/main']);
  const [sha] = output.split(/\s+/u);
  if (!/^[0-9a-f]{40}$/u.test(sha ?? '')) throw new Error('remote_main_sha_unavailable');
  return sha;
}

function verifyRemoteMain(localSha = runGit(['rev-parse', 'HEAD'])) {
  const remoteSha = remoteMainSha();
  if (localSha !== remoteSha) {
    throw new Error(`remote_main_sha_mismatch:local=${localSha}:remote=${remoteSha}`);
  }
  return localSha;
}

function stageAndCommit(worktreePath, paths) {
  runGitAt(worktreePath, ['add', '--', ...paths]);
  try {
    runGitAt(worktreePath, ['diff', '--cached', '--quiet'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return false;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  runGitAt(worktreePath, ['commit', '-m', commitMessage]);
  return true;
}

function waitBeforeRetry(attempt) {
  const delayMs = RETRY_DELAY_SECONDS * attempt * 1000;
  execFileSync('sleep', [String(delayMs / 1000)], { stdio: 'ignore' });
}

function removeTemporaryWorktree(worktreePath, parentDir) {
  try {
    runGit(['worktree', 'remove', worktreePath]);
  } catch {
    // A failed attempt can leave staged files in the temporary checkout. The
    // parent is outside the repository; prune only its stale worktree record.
    try {
      fs.rmSync(parentDir, { recursive: true });
    } finally {
      try {
        runGit(['worktree', 'prune']);
      } catch {
        // Preserve the original publish error.
      }
    }
  }
}

function publishAttempt(artifactDir, paths) {
  const worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'report-publish-worktree-'));
  const worktreePath = path.join(worktreeParent, 'checkout');
  try {
    runGit(['worktree', 'add', '--detach', worktreePath, 'origin/main']);
    restoreGeneratedFiles(artifactDir, paths, worktreePath);
    stageAndCommit(worktreePath, paths);
    const publishedSha = runGitAt(worktreePath, ['rev-parse', 'HEAD']);
    const remoteShaBeforePush = remoteMainSha();
    if (publishedSha !== remoteShaBeforePush) {
      runGitAt(worktreePath, ['push', 'origin', 'HEAD:main']);
    }
    runGit(['fetch', 'origin', 'main']);
    return verifyRemoteMain(publishedSha);
  } finally {
    removeTemporaryWorktree(worktreePath, worktreeParent);
  }
}

function publish(paths) {
  const artifactDir = preserveGeneratedFiles(paths);
  try {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        runGit(['fetch', 'origin', 'main']);
        const sha = publishAttempt(artifactDir, paths);
        console.log(JSON.stringify({ ok: true, attempts: attempt, publishedSha: sha }));
        return;
      } catch (error) {
        lastError = error;
        if (attempt === MAX_ATTEMPTS) break;
        waitBeforeRetry(attempt);
      }
    }
    throw new Error(`publish_failed_after_${MAX_ATTEMPTS}_attempts:${lastError?.message ?? 'unknown'}`);
  } finally {
    fs.rmSync(artifactDir, { recursive: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    publish(normalizePaths(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { MAX_ATTEMPTS, normalizePaths, preserveGeneratedFiles, publish, verifyRemoteMain };
