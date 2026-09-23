import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  describe("hasChanges", () => {
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

    it("stops accumulating slug words once the next word would exceed the 30-char cap", () => {
      // "reallylongfirstslugword" (24 chars) + "-" + "anotherlongword" (15 chars) = 40 chars,
      // which exceeds maxLen=30, so the second word must be dropped.
      const result = buildWorktreeDirName(
        "abcdefgh",
        "pry-42-reallylongfirstslugword-anotherlongword-third",
      );
      expect(result).toBe("run-abcdefgh-pry-42-reallylongfirstslugword");
    });
  });

  describe("GitError", () => {
    it("stringifies a non-Error cause", () => {
      const err = new GitError("fetch", "/repo", "plain string failure");
      expect(err.message).toBe("git fetch failed in /repo: plain string failure");
      expect(err.name).toBe("GitError");
    });

    it("uses the Error's message when the cause is an Error instance", () => {
      const err = new GitError("push", "/repo", new Error("non-fast-forward"));
      expect(err.message).toBe("git push failed in /repo: non-fast-forward");
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
  });

  describe("push / commitAndPush against a real remote", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("push() pushes the current branch to origin", async () => {
      git(["checkout", "-b", "push-me"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      git(["add", "."], repoPath);
      git(["commit", "-m", "commit to push"], repoPath);

      await svc.push(repoPath, "push-me");

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("refs/heads/push-me");
    });

    it("push() throws GitError when the branch cannot be pushed", async () => {
      // No such local branch exists, so the push must fail.
      await expect(svc.push(repoPath, "does-not-exist")).rejects.toThrow(GitError);
    });

    it("commitAndPush asserts the branch, commits pending changes, and pushes", async () => {
      git(["checkout", "-b", "combo-branch"], repoPath);
      writeFileSync(join(repoPath, "combo.txt"), "content");

      await svc.commitAndPush(repoPath, "combo-branch", "combo commit");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("combo commit");
      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("refs/heads/combo-branch");
    });

    it("commitAndPush throws BranchMismatchError before committing when on the wrong branch", async () => {
      git(["checkout", "-b", "wrong-branch"], repoPath);
      writeFileSync(join(repoPath, "should-not-commit.txt"), "content");

      await expect(
        svc.commitAndPush(repoPath, "expected-branch", "should not happen"),
      ).rejects.toThrow(BranchMismatchError);

      // The file should still be uncommitted since commitAndPush bailed before commitAll.
      expect(await svc.hasChanges(repoPath)).toBe(true);
    });
  });

  describe("setupRunWorktree: existing worktree path and existing remote branch", () => {
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

    it("removes and recreates the worktree when the deterministic path already exists", async () => {
      const runId = "aaaaaaaa-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-recreate-path";

      // Pre-create a worktree at the exact deterministic path setupRunWorktree will compute.
      const shortId = runId.slice(0, 8);
      const dirName = `run-${shortId}-pry-200-recreate-path`;
      const worktreePath = join(repoPath, ".worktrees", dirName);
      await svc.createWorktree(repoPath, worktreePath, "leftover-branch", "main");
      expect(existsSync(worktreePath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("logs a warning but proceeds when origin/<branch> already exists", async () => {
      const branchName = "hidday/pry-201-existing-remote";
      // Push the branch to origin first so `origin/<branchName>` already exists.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);

      const warnings: unknown[] = [];
      const logger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnings.push(args),
      };
      const svcWithWarnLogger = new GitService(logger);

      const runId = "bbbbbbbb-3456-7890-abcd-ef1234567890";
      const result = await svcWithWarnLogger.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(await svcWithWarnLogger.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        warnings.some((call) =>
          JSON.stringify(call).includes("origin/<branch> already exists"),
        ),
      ).toBe(true);

      await svcWithWarnLogger.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("wrapped git command failures throw GitError", () => {
    it("fetch() throws GitError when there is no origin remote configured", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });

    it("createWorktree() throws GitError when the start point does not exist", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-start-point");
      await expect(
        svc.createWorktree(repoPath, wtPath, "some-branch", "does-not-exist"),
      ).rejects.toThrow(GitError);
    });

    it("findWorktreeForBranch() throws GitError for an invalid repo path", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent", "main")).rejects.toThrow(GitError);
    });

    it("removeWorktree() logs a warning but does not throw when the worktree does not exist", async () => {
      const warnings: unknown[] = [];
      const logger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnings.push(args),
      };
      const svcWithWarnLogger = new GitService(logger);

      await expect(
        svcWithWarnLogger.removeWorktree(repoPath, join(repoPath, ".worktrees", "never-created")),
      ).resolves.toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("hasChanges() throws GitError for an invalid repo path", async () => {
      await expect(svc.hasChanges("/nonexistent")).rejects.toThrow(GitError);
    });

    it("commitAll() throws GitError when `git add` fails on an invalid repo path", async () => {
      await expect(svc.commitAll("/nonexistent", "message")).rejects.toThrow(GitError);
    });
  });

  describe("pruneWorktrees", () => {
    it("logs a warning and resolves (does not throw) when git worktree prune fails", async () => {
      const warnings: unknown[] = [];
      const logger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnings.push(args),
      };
      const svcWithWarnLogger = new GitService(logger);

      await expect(svcWithWarnLogger.pruneWorktrees("/nonexistent")).resolves.toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
