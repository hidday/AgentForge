import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  GitService,
  BranchMismatchError,
  GitError,
  buildWorktreeDirName,
} from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("GitService", () => {
  let repoPath: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    svc = new GitService(noopLogger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe("currentBranch", () => {
    it("returns the current branch name", async () => {
      const branch = await svc.currentBranch(repoPath);
      expect(branch).toBe("main");
    });
  });

  describe("assertBranch", () => {
    it("succeeds when on the expected branch", async () => {
      await expect(svc.assertBranch(repoPath, "main")).resolves.toBeUndefined();
    });

    it("throws BranchMismatchError when on wrong branch", async () => {
      git(["checkout", "-b", "other"], repoPath);
      await expect(svc.assertBranch(repoPath, "main")).rejects.toThrow(BranchMismatchError);
    });
  });

  describe("removeWorktree", () => {
    it("swallows the error and warns (best-effort cleanup) when the path is not a worktree", async () => {
      const warnLogger = {
        info: () => {},
        warn: vi.fn(),
        error: () => {},
        debug: () => {},
        fatal: () => {},
        child: () => warnLogger,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const warnSvc = new GitService(warnLogger);

      await expect(
        warnSvc.removeWorktree(repoPath, join(repoPath, "not-a-worktree")),
      ).resolves.toBeUndefined();

      expect(warnLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath }),
        "Failed to remove worktree (best-effort cleanup)",
      );
    });
  });

  describe("hasChanges", () => {
    it("wraps a failing status check (not a git repository) in a GitError", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-notrepo-"));
      try {
        await expect(svc.hasChanges(notARepo)).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });

    it("returns false for clean working tree", async () => {
      expect(await svc.hasChanges(repoPath)).toBe(false);
    });

    it("returns true for dirty working tree", async () => {
      writeFileSync(join(repoPath, "new.txt"), "hello");
      expect(await svc.hasChanges(repoPath)).toBe(true);
    });
  });

  describe("commitAll", () => {
    it("commits all staged and unstaged changes", async () => {
      writeFileSync(join(repoPath, "file.txt"), "content");
      await svc.commitAll(repoPath, "test commit");
      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("test commit");
      expect(await svc.hasChanges(repoPath)).toBe(false);
    });

    it("skips commit when there are no changes", async () => {
      const logBefore = git(["log", "--oneline"], repoPath);
      await svc.commitAll(repoPath, "empty commit");
      const logAfter = git(["log", "--oneline"], repoPath);
      expect(logAfter).toBe(logBefore);
    });

    it("wraps a failing git invocation (stale index.lock) in a GitError", async () => {
      writeFileSync(join(repoPath, "file2.txt"), "content");
      // A pre-existing index.lock makes any `git add`/`git commit` in this repo fail.
      const lockPath = join(repoPath, ".git", "index.lock");
      writeFileSync(lockPath, "");
      try {
        await expect(svc.commitAll(repoPath, "will fail")).rejects.toThrow(GitError);
      } finally {
        rmSync(lockPath, { force: true });
      }
    });
  });

  describe("push", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("pushes the current branch to origin and sets upstream", async () => {
      git(["checkout", "-b", "feature/push-me"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      git(["add", "."], repoPath);
      git(["commit", "-m", "pushed commit"], repoPath);

      await svc.push(repoPath, "feature/push-me");

      const remoteBranches = git(["branch", "-r"], repoPath);
      expect(remoteBranches).toContain("origin/feature/push-me");
    });

    it("wraps a push failure (no such remote) in a GitError", async () => {
      git(["remote", "remove", "origin"], repoPath);
      git(["checkout", "-b", "feature/no-remote"], repoPath);

      await expect(svc.push(repoPath, "feature/no-remote")).rejects.toThrow(GitError);
    });
  });

  describe("commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-candp-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("asserts the branch, commits, and pushes in sequence", async () => {
      git(["checkout", "-b", "feature/full-flow"], repoPath);
      writeFileSync(join(repoPath, "flow.txt"), "content");

      await svc.commitAndPush(repoPath, "feature/full-flow", "full flow commit");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("full flow commit");
      expect(git(["branch", "-r"], repoPath)).toContain("origin/feature/full-flow");
    });

    it("throws BranchMismatchError and never commits or pushes when on the wrong branch", async () => {
      git(["checkout", "-b", "feature/wrong-branch"], repoPath);
      writeFileSync(join(repoPath, "flow2.txt"), "content");

      await expect(
        svc.commitAndPush(repoPath, "feature/expected-branch", "should not commit"),
      ).rejects.toThrow(BranchMismatchError);

      // The file should still be unstaged/uncommitted — commitAll was never reached.
      expect(await svc.hasChanges(repoPath)).toBe(true);
      expect(git(["branch", "-r"], repoPath)).not.toContain("origin/feature/expected-branch");
    });
  });

  describe("createWorktree / removeWorktree", () => {
    it("creates a worktree with a new branch", async () => {
      const wtPath = join(repoPath, ".worktrees", "test-wt");
      await svc.createWorktree(repoPath, wtPath, "feature-branch", "main");

      expect(existsSync(wtPath)).toBe(true);
      const branch = await svc.currentBranch(wtPath);
      expect(branch).toBe("feature-branch");

      // worktree .git is a file, not a directory
      const gitEntry = join(wtPath, ".git");
      expect(existsSync(gitEntry)).toBe(true);
      const stat = readFileSync(gitEntry, "utf-8");
      expect(stat).toContain("gitdir:");
    });

    it("removeWorktree removes the worktree", async () => {
      const wtPath = join(repoPath, ".worktrees", "test-wt2");
      await svc.createWorktree(repoPath, wtPath, "branch2", "main");
      expect(existsSync(wtPath)).toBe(true);

      await svc.removeWorktree(repoPath, wtPath);
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("setupRunWorktree", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("creates a worktree branched from main", async () => {
      const runId = "abcdef12-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-42-test-branch";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.branchName).toBe(branchName);
      expect(result.worktreePath).toContain(".worktrees");
      expect(result.worktreePath).toContain("run-abcdef12-pry-42-test-branch");
      expect(existsSync(result.worktreePath)).toBe(true);

      const branch = await svc.currentBranch(result.worktreePath);
      expect(branch).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("recovers when the branch already exists locally (no worktree)", async () => {
      // Simulate a crashed prior run: branch left behind, no worktree record.
      const branchName = "hidday/pry-99-leftover";
      git(["branch", branchName, "main"], repoPath);

      const runId = "beefcafe-3456-7890-abcd-ef1234567890";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("recovers when the branch is checked out in a stale worktree", async () => {
      // Simulate a prior run that left both a branch and a worktree admin record.
      const branchName = "hidday/pry-100-stale-wt";
      const stalePath = join(repoPath, ".worktrees", "run-stale-xyz");
      await svc.createWorktree(repoPath, stalePath, branchName, "main");
      expect(existsSync(stalePath)).toBe(true);

      const runId = "deadbeef-3456-7890-abcd-ef1234567890";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(result.worktreePath).not.toBe(stalePath);
      expect(existsSync(stalePath)).toBe(false);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("removes and recreates the worktree directory when the target path already exists on disk", async () => {
      const warnLogger = {
        info: () => {},
        warn: vi.fn(),
        error: () => {},
        debug: () => {},
        fatal: () => {},
        child: () => warnLogger,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const warnSvc = new GitService(warnLogger);

      const runId = "11112222-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-first-pass";

      const first = await warnSvc.setupRunWorktree(repoPath, runId, "main", branchName);
      expect(existsSync(first.worktreePath)).toBe(true);

      warnLogger.warn.mockClear();
      const second = await warnSvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(existsSync(second.worktreePath)).toBe(true);
      expect(await warnSvc.currentBranch(second.worktreePath)).toBe(branchName);
      expect(warnLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ worktreePath: first.worktreePath }),
        "Worktree path already exists, removing first",
      );

      await warnSvc.removeWorktree(repoPath, second.worktreePath);
    });

    it("warns but proceeds when origin/<branch> already exists remotely", async () => {
      const warnLogger = {
        info: () => {},
        warn: vi.fn(),
        error: () => {},
        debug: () => {},
        fatal: () => {},
        child: () => warnLogger,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const warnSvc = new GitService(warnLogger);

      const branchName = "hidday/pry-201-already-remote";
      // Push the branch to origin ahead of time to simulate a prior run's remote branch.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);
      git(["branch", "-D", branchName], repoPath);

      const runId = "33334444-3456-7890-abcd-ef1234567890";
      const result = await warnSvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(warnLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, branchName }),
        expect.stringContaining("origin/<branch> already exists"),
      );

      await warnSvc.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("findWorktreeForBranch", () => {
    it("returns null when no worktree has the branch", async () => {
      expect(await svc.findWorktreeForBranch(repoPath, "nope")).toBeNull();
    });

    it("returns the worktree path when a worktree has the branch", async () => {
      const wtPath = join(repoPath, ".worktrees", "feat-wt");
      await svc.createWorktree(repoPath, wtPath, "feat-branch", "main");

      const found = await svc.findWorktreeForBranch(repoPath, "feat-branch");
      expect(found).not.toBeNull();
      // macOS resolves /var -> /private/var; compare by realpath.
      expect(readFileSync(join(wtPath, ".git"), "utf-8")).toContain("gitdir:");
      // We only assert the basename to avoid /var vs /private/var symlink issues.
      expect(found?.endsWith("feat-wt")).toBe(true);

      await svc.removeWorktree(repoPath, wtPath);
    });
  });

  describe("buildWorktreeDirName", () => {
    it("appends the linear issue id and the first slug words", () => {
      expect(
        buildWorktreeDirName(
          "abcdefgh",
          "hidday/pry-751-fixpayments-server-side-search-with-proper-debounce-loading",
        ),
      ).toBe("run-abcdefgh-pry-751-fixpayments-server-side-search");
    });

    it("works without a user prefix", () => {
      expect(buildWorktreeDirName("abcdefgh", "pry-42-do-the-thing")).toBe(
        "run-abcdefgh-pry-42-do-the-thing",
      );
    });

    it("includes only the issue id when there is no slug", () => {
      expect(buildWorktreeDirName("abcdefgh", "hidday/pry-42")).toBe(
        "run-abcdefgh-pry-42",
      );
    });

    it("lowercases the issue id", () => {
      expect(buildWorktreeDirName("abcdefgh", "hidday/PRY-12-FIX-Bug")).toBe(
        "run-abcdefgh-pry-12-fix-bug",
      );
    });

    it("falls back to run-<shortId> when no issue id is present", () => {
      expect(buildWorktreeDirName("abcdefgh", "hidday/some-branch-name")).toBe(
        "run-abcdefgh",
      );
      expect(buildWorktreeDirName("abcdefgh", "")).toBe("run-abcdefgh");
    });
  });

  describe("resolveMainRepoPath", () => {
    it("strips .worktrees/ suffix", () => {
      expect(svc.resolveMainRepoPath("/repos/myrepo/.worktrees/run-abc")).toBe("/repos/myrepo");
    });

    it("returns path as-is when no .worktrees/ present", () => {
      expect(svc.resolveMainRepoPath("/repos/myrepo")).toBe("/repos/myrepo");
    });
  });

  describe("error handling", () => {
    it("throws GitError for invalid repo path", async () => {
      await expect(svc.currentBranch("/nonexistent")).rejects.toThrow(GitError);
    });

    it("wraps a failing fetch (no origin remote) in a GitError", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });

    it("wraps a failing createWorktree (bad start point) in a GitError", async () => {
      const worktreePath = join(repoPath, ".worktrees", "bad");
      await expect(
        svc.createWorktree(repoPath, worktreePath, "ai/bad-start", "not-a-real-ref"),
      ).rejects.toThrow(GitError);
    });

    it("pruneWorktrees swallows the error and warns instead of throwing on a non-git directory", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-notrepo-"));
      try {
        const warnLogger = { ...noopLogger, warn: vi.fn() };
        const warnSvc = new GitService(warnLogger);
        await expect(warnSvc.pruneWorktrees(notARepo)).resolves.toBeUndefined();
        expect(warnLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ repoPath: notARepo }),
          "Failed to prune worktrees (best-effort cleanup)",
        );
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });

    it("findWorktreeForBranch wraps a failing 'worktree list' in a GitError", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-notrepo-"));
      try {
        await expect(svc.findWorktreeForBranch(notARepo, "any-branch")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });

    it("GitError formats a non-Error cause via String() instead of .message", () => {
      const err = new GitError("fetch", "/tmp/repo", "a plain string failure");
      expect(err.message).toBe("git fetch failed in /tmp/repo: a plain string failure");
    });
  });
});
