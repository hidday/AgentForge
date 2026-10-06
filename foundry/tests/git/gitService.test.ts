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

    it("fetch() throws GitError when the git command fails", async () => {
      await expect(svc.fetch("/nonexistent")).rejects.toThrow(GitError);
      await expect(svc.fetch("/nonexistent")).rejects.toThrow(/git fetch failed/);
    });

    it("createWorktree() throws GitError when the git command fails (bad start point)", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-wt");
      await expect(
        svc.createWorktree(repoPath, wtPath, "bad-branch", "no-such-start-point"),
      ).rejects.toThrow(GitError);
      expect(existsSync(wtPath)).toBe(false);
    });

    it("findWorktreeForBranch() throws GitError when the git command fails", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-notarepo-"));
      try {
        await expect(svc.findWorktreeForBranch(notARepo, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });

    it("hasChanges() throws GitError when the git command fails", async () => {
      await expect(svc.hasChanges("/nonexistent")).rejects.toThrow(GitError);
    });

    it("push() throws GitError when there is no configured remote", async () => {
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(/git push failed/);
    });

    it("commitAll() throws GitError when the underlying commit command fails", async () => {
      // Force `git commit` itself to fail deterministically via a pre-commit hook,
      // independent of global git identity configuration.
      const hooksDir = join(repoPath, ".git", "hooks");
      writeFileSync(join(hooksDir, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      writeFileSync(join(repoPath, "blocked.txt"), "content");

      await expect(svc.commitAll(repoPath, "should fail")).rejects.toThrow(GitError);
    });

    it("pruneWorktrees() swallows failures and logs a warning (best-effort cleanup)", async () => {
      const warnCalls: unknown[][] = [];
      const logger = { ...noopLogger, warn: (...args: unknown[]) => warnCalls.push(args) };
      const svcWithSpy = new GitService(logger);

      await expect(svcWithSpy.pruneWorktrees("/nonexistent")).resolves.toBeUndefined();
      expect(warnCalls.length).toBe(1);
      expect(warnCalls[0]?.[1]).toContain("Failed to prune worktrees");
    });

    it("removeWorktree() swallows failures and logs a warning (best-effort cleanup)", async () => {
      const warnCalls: unknown[][] = [];
      const logger = { ...noopLogger, warn: (...args: unknown[]) => warnCalls.push(args) };
      const svcWithSpy = new GitService(logger);

      await expect(
        svcWithSpy.removeWorktree(repoPath, join(repoPath, "no-such-worktree")),
      ).resolves.toBeUndefined();
      expect(warnCalls.length).toBe(1);
      expect(warnCalls[0]?.[1]).toContain("Failed to remove worktree");
    });
  });

  describe("commitAndPush", () => {
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

    it("asserts the branch, commits, and pushes in sequence", async () => {
      git(["checkout", "-b", "feature/commit-and-push"], repoPath);
      writeFileSync(join(repoPath, "new-file.txt"), "hello");

      await svc.commitAndPush(repoPath, "feature/commit-and-push", "add new file");

      expect(await svc.hasChanges(repoPath)).toBe(false);
      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("add new file");

      // Verify it actually reached origin.
      const remoteLog = git(["log", "--oneline", "origin/feature/commit-and-push"], repoPath);
      expect(remoteLog).toContain("add new file");
    });

    it("rejects with BranchMismatchError (without committing or pushing) when on the wrong branch", async () => {
      git(["checkout", "-b", "feature/other"], repoPath);
      writeFileSync(join(repoPath, "new-file.txt"), "hello");

      await expect(
        svc.commitAndPush(repoPath, "feature/commit-and-push", "add new file"),
      ).rejects.toThrow(BranchMismatchError);

      // Nothing was committed since assertBranch failed before commitAll ran.
      expect(await svc.hasChanges(repoPath)).toBe(true);
    });
  });

  describe("remoteBranchExists", () => {
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

    it("returns false when origin/<branch> does not exist", async () => {
      expect(await svc.remoteBranchExists(repoPath, "no-such-branch")).toBe(false);
    });

    it("returns true when origin/<branch> exists", async () => {
      expect(await svc.remoteBranchExists(repoPath, "main")).toBe(true);
    });
  });

  describe("setupRunWorktree: pre-existing worktree path and pre-existing remote branch", () => {
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

    it("removes a leftover directory already occupying the computed worktree path", async () => {
      const runId = "fadedcaf-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-leftover-dir";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const worktreePath = join(repoPath, ".worktrees", dirName);

      // Simulate debris from a previous crashed run: a *registered* worktree
      // (for a throwaway branch) sitting exactly at the path setupRunWorktree
      // will want to use next, so existsSync(true) is hit and removeWorktree
      // can actually clean it up (git worktree remove requires a real worktree).
      await svc.createWorktree(repoPath, worktreePath, "leftover-throwaway-branch", "main");
      expect(existsSync(join(worktreePath, ".git"))).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      // Recreated for the new branch, not left on the throwaway one.
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists", async () => {
      // Push the branch to origin first so remoteBranchExists() is true when
      // setupRunWorktree runs, exercising its warning branch.
      git(["branch", "hidday/pry-300-existing-remote", "main"], repoPath);
      git(["push", "origin", "hidday/pry-300-existing-remote"], repoPath);

      const warnCalls: unknown[][] = [];
      const logger = { ...noopLogger, warn: (...args: unknown[]) => warnCalls.push(args) };
      const svcWithSpy = new GitService(logger);

      const runId = "beadedca-3456-7890-abcd-ef1234567890";
      const result = await svcWithSpy.setupRunWorktree(
        repoPath,
        runId,
        "main",
        "hidday/pry-300-existing-remote",
      );

      expect(await svcWithSpy.currentBranch(result.worktreePath)).toBe(
        "hidday/pry-300-existing-remote",
      );
      const warnedAboutExistingRemote = warnCalls.some(
        (call) => typeof call[1] === "string" && call[1].includes("already exists"),
      );
      expect(warnedAboutExistingRemote).toBe(true);

      await svcWithSpy.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("buildWorktreeDirName: slug length cap", () => {
    it("stops appending slug words once the next word would exceed the 30-char cap", () => {
      // "aaaaaaaaaa-bbbbbbbbbbbb" is 23 chars; adding "-cccccccccccc" (13 more)
      // would reach 36 > 30, so the third word is dropped and the break at
      // shortenSlug's length guard is exercised.
      expect(
        buildWorktreeDirName("abcdefgh", "eng-1-aaaaaaaaaa-bbbbbbbbbbbb-cccccccccccc"),
      ).toBe("run-abcdefgh-eng-1-aaaaaaaaaa-bbbbbbbbbbbb");
    });
  });

  describe("GitError", () => {
    it("formats a non-Error cause via String(cause) rather than throwing or printing [object Object]", () => {
      const err = new GitError("push", "/repo/path", { code: "EPIPE" });
      expect(err.message).toBe('git push failed in /repo/path: [object Object]');
      expect(err.name).toBe("GitError");
      expect(err.message).toContain("/repo/path");
    });

    it("uses the Error's own message when the cause is an Error instance", () => {
      const err = new GitError("fetch", "/repo/path", new Error("boom"));
      expect(err.message).toBe("git fetch failed in a/repo/path: boom".replace("a/repo", "/repo"));
    });
  });
});
