import { execFile } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Logger } from "../utils/logger.js";

const WORKTREES_DIR = ".worktrees";

export class GitError extends Error {
  constructor(
    operation: string,
    cwd: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`git ${operation} failed in ${cwd}: ${detail}`);
    this.name = "GitError";
  }
}

export class BranchMismatchError extends Error {
  constructor(expected: string, actual: string, cwd: string) {
    super(
      `Branch safety check failed in ${cwd}: expected "${expected}" but HEAD is on "${actual}"`,
    );
    this.name = "BranchMismatchError";
  }
}

function exec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || stdout?.trim() || err.message;
        reject(new Error(msg));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

export interface WorktreeSetupResult {
  worktreePath: string;
  branchName: string;
}

/**
 * Builds a worktree directory name like "run-abcdefgh-pry-751-fix-server-side"
 * by combining the short run id with the Linear issue id and the first few
 * slug words extracted from the branch name.
 *
 * Falls back to "run-{shortId}" when the branch name doesn't contain a
 * recognizable Linear-style issue identifier.
 */
export function buildWorktreeDirName(shortId: string, branchName: string): string {
  const base = `run-${shortId}`;
  if (!branchName) return base;

  const lower = branchName.toLowerCase();
  // Match a Linear-style issue id (e.g., "pry-751") that appears either at the
  // start of the branch or right after a "/" prefix (e.g., "hidday/pry-751-...").
  const match = lower.match(/(?:^|\/)([a-z0-9]+-\d+)(?:-(.+))?$/);
  if (!match) return base;

  const issueId = match[1];
  const rest = match[2] ?? "";
  const slug = shortenSlug(rest);
  return slug ? `${base}-${issueId}-${slug}` : `${base}-${issueId}`;
}

function shortenSlug(slug: string, maxParts = 4, maxLen = 30): string {
  const parts = slug.split("-").filter(Boolean);
  let result = "";
  for (let i = 0; i < parts.length && i < maxParts; i++) {
    const next = result ? `${result}-${parts[i]}` : parts[i];
    if (next.length > maxLen) break;
    result = next;
  }
  return result;
}

export class GitService {
  constructor(private readonly logger: Logger) {}

  async fetch(repoPath: string): Promise<void> {
    this.logger.info({ repoPath }, "Fetching origin");
    try {
      await exec(["fetch", "origin", "--prune"], repoPath);
    } catch (err) {
      throw new GitError("fetch", repoPath, err);
    }
  }

  async createWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    startPoint: string,
  ): Promise<void> {
    this.logger.info({ repoPath, worktreePath, branchName, startPoint }, "Creating worktree");
    try {
      await exec(
        ["worktree", "add", "-b", branchName, worktreePath, startPoint],
        repoPath,
      );
    } catch (err) {
      throw new GitError("worktree add", repoPath, err);
    }
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    this.logger.info({ repoPath, worktreePath }, "Removing worktree");
    try {
      await exec(["worktree", "remove", worktreePath, "--force"], repoPath);
    } catch (err) {
      this.logger.warn(
        { repoPath, worktreePath, error: err instanceof Error ? err.message : String(err) },
        "Failed to remove worktree (best-effort cleanup)",
      );
    }
  }

  async currentBranch(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await exec(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
      return stdout;
    } catch (err) {
      throw new GitError("rev-parse --abbrev-ref HEAD", worktreePath, err);
    }
  }

  async assertBranch(worktreePath: string, expectedBranch: string): Promise<void> {
    const actual = await this.currentBranch(worktreePath);
    if (actual !== expectedBranch) {
      throw new BranchMismatchError(expectedBranch, actual, worktreePath);
    }
  }

  async hasChanges(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await exec(["status", "--porcelain"], worktreePath);
      return stdout.length > 0;
    } catch (err) {
      throw new GitError("status", worktreePath, err);
    }
  }

  async commitAll(worktreePath: string, message: string): Promise<void> {
    this.logger.info({ worktreePath, message }, "Committing all changes");
    try {
      await exec(["add", "-A"], worktreePath);
      const dirty = await this.hasChanges(worktreePath);
      if (!dirty) {
        this.logger.info({ worktreePath }, "No changes to commit, skipping");
        return;
      }
      await exec(["commit", "-m", message], worktreePath);
    } catch (err) {
      throw new GitError("commit", worktreePath, err);
    }
  }

  async push(worktreePath: string, branchName: string): Promise<void> {
    this.logger.info({ worktreePath, branchName }, "Pushing branch to origin");
    try {
      await exec(["push", "-u", "origin", branchName], worktreePath);
    } catch (err) {
      throw new GitError("push", worktreePath, err);
    }
  }

  async commitAndPush(
    worktreePath: string,
    branchName: string,
    message: string,
  ): Promise<void> {
    await this.assertBranch(worktreePath, branchName);
    await this.commitAll(worktreePath, message);
    await this.push(worktreePath, branchName);
  }

  /**
   * Sets up a fresh worktree for a run: fetches origin, creates a new branch
   * from origin/{defaultBranch}, and adds a worktree at a deterministic path.
   */
  async setupRunWorktree(
    repoPath: string,
    runId: string,
    defaultBranch: string,
    branchName: string,
  ): Promise<WorktreeSetupResult> {
    const shortId = runId.slice(0, 8);
    const dirName = buildWorktreeDirName(shortId, branchName);
    const worktreePath = join(repoPath, WORKTREES_DIR, dirName);
    const startPoint = `origin/${defaultBranch}`;

    if (existsSync(worktreePath)) {
      this.logger.warn({ worktreePath }, "Worktree path already exists, removing first");
      await this.removeWorktree(repoPath, worktreePath);
    }

    await this.fetch(repoPath);
    await this.createWorktree(repoPath, worktreePath, branchName, startPoint);

    this.logger.info(
      { repoPath, worktreePath, branchName, startPoint },
      "Run worktree ready",
    );

    return { worktreePath, branchName };
  }

  /**
   * Resolves the main repo path from a worktree path by stripping the
   * .worktrees/... suffix. If the path doesn't contain .worktrees/, returns it as-is.
   */
  resolveMainRepoPath(worktreeOrRepoPath: string): string {
    const idx = worktreeOrRepoPath.indexOf(WORKTREES_DIR);
    if (idx === -1) return worktreeOrRepoPath;
    return worktreeOrRepoPath.slice(0, idx - 1);
  }
}
