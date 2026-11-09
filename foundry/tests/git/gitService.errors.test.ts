import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

// Covers error/warning-path branches in gitService.ts that neither
// gitService.test.ts nor gitService.branches.test.ts exercise: the catch
// blocks of fetch, createWorktree, pruneWorktrees, findWorktreeForBranch,
// removeWorktree, hasChanges and commitAll, plus GitError's non-Error cause
// handling and the maxLen break in shortenSlug (via buildWorktreeDirName).

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-errors-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeLogger() {
  const warnMessages: string[] = [];
  const logger = {
    info: () => {},
    warn: (_meta: unknown, msg: string) => {
      warnMessages.push(msg);
    },
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => logger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { logger, warnMessages };
}

describe("GitService error/warning paths", () => {
  let repoPath: string;
  let svc: GitService;
  let warnMessages: string[];

  beforeEach(() => {
    repoPath = createTestRepo();
    const made = makeLogger();
    svc = new GitService(made.logger);
    warnMessages = made.warnMessages;
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("fetch() wraps a failure (no origin remote configured) in a GitError", async () => {
    await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed/);
  });

  it("createWorktree() wraps a failure (nonexistent start point) in a GitError", async () => {
    const wtPath = join(repoPath, ".worktrees", "bad-start-point");
    await expect(
      svc.createWorktree(repoPath, wtPath, "some-branch", "refs/heads/does-not-exist"),
    ).rejects.toThrow(GitError);
    await expect(
      svc.createWorktree(repoPath, wtPath, "some-branch-2", "refs/heads/does-not-exist"),
    ).rejects.toThrow(/git worktree add failed/);
  });

  it("pruneWorktrees() logs a warning instead of throwing when the command fails", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "gitservice-errors-notarepo-"));
    try {
      await expect(svc.pruneWorktrees(notARepo)).resolves.toBeUndefined();
      expect(warnMessages).toContain("Failed to prune worktrees (best-effort cleanup)");
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("findWorktreeForBranch() wraps a failure (not a git repository) in a GitError", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "gitservice-errors-notarepo2-"));
    try {
      await expect(svc.findWorktreeForBranch(notARepo, "main")).rejects.toThrow(GitError);
      await expect(svc.findWorktreeForBranch(notARepo, "main")).rejects.toThrow(
        /git worktree list failed/,
      );
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("removeWorktree() logs a warning instead of throwing for a path that isn't a registered worktree", async () => {
    const notAWorktree = join(repoPath, ".worktrees", "never-created");
    mkdirSync(notAWorktree, { recursive: true });

    await expect(svc.removeWorktree(repoPath, notAWorktree)).resolves.toBeUndefined();
    expect(warnMessages).toContain("Failed to remove worktree (best-effort cleanup)");
  });

  it("hasChanges() wraps a failure (not a git repository) in a GitError", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "gitservice-errors-notarepo3-"));
    try {
      await expect(svc.hasChanges(notARepo)).rejects.toThrow(GitError);
      await expect(svc.hasChanges(notARepo)).rejects.toThrow(/git status failed/);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("commitAll() wraps a failure (not a git repository) in a GitError", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "gitservice-errors-notarepo4-"));
    try {
      await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(GitError);
      await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(/git commit failed/);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe("GitError", () => {
  it("stringifies a non-Error cause in its message", () => {
    const err = new GitError("fetch", "/some/repo", "a plain string cause");
    expect(err.message).toBe('git fetch failed in /some/repo: a plain string cause');
    expect(err.name).toBe("GitError");
  });
});

describe("buildWorktreeDirName — shortenSlug maxLen break", () => {
  it("stops adding words once the next word would exceed the 30-char slug cap, independent of the 4-word cap", () => {
    // Two 15-char words joined by a dash are 31 chars, over the cap, so the
    // second word must be dropped even though only 2 of the 4 allowed words
    // have been used.
    const branchName = "hidday/pry-7-fifteencharwrd1-fifteencharwrd2-short";
    const result = buildWorktreeDirName("abcdefgh", branchName);
    expect(result).toBe("run-abcdefgh-pry-7-fifteencharwrd1");
    expect(result).not.toContain("fifteencharwrd2");
  });
});
