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

    it("fetch throws GitError when origin fetch fails", async () => {
      await expect(svc.fetch("/nonexistent")).rejects.toThrow(GitError);
    });

    it("createWorktree throws GitError when the start point doesn't exist", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-startpoint");
      await expect(
        svc.createWorktree(repoPath, wtPath, "new-branch", "nonexistent-startpoint"),
      ).rejects.toThrow(GitError);
      expect(existsSync(wtPath)).toBe(false);
    });

    it("findWorktreeForBranch throws GitError for an invalid repo path", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent", "main")).rejects.toThrow(GitError);
    });

    it("hasChanges throws GitError for an invalid repo path", async () => {
      await expect(svc.hasChanges("/nonexistent")).rejects.toThrow(GitError);
    });

    it("commitAll throws GitError when the underlying git commands fail", async () => {
      await expect(svc.commitAll("/nonexistent", "msg")).rejects.toThrow(GitError);
    });

    it("push throws GitError when there is no origin remote configured", async () => {
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
    });

    it("pruneWorktrees swallows errors and logs a warning instead of throwing", async () => {
      const warnSpy = vi.fn();
      const svc2 = new GitService({ ...noopLogger, warn: warnSpy });

      await expect(svc2.pruneWorktrees("/nonexistent")).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: "/nonexistent" }),
        "Failed to prune worktrees (best-effort cleanup)",
      );
    });

    it("removeWorktree swallows errors and logs a warning instead of throwing", async () => {
      const warnSpy = vi.fn();
      const svc2 = new GitService({ ...noopLogger, warn: warnSpy });
      const nonWorktreePath = join(repoPath, "never-a-worktree");

      await expect(svc2.removeWorktree(repoPath, nonWorktreePath)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, worktreePath: nonWorktreePath }),
        "Failed to remove worktree (best-effort cleanup)",
      );
    });
  });

  describe("GitError", () => {
    it("stringifies a non-Error cause via String(cause)", () => {
      const err = new GitError("op", "/tmp/repo", "boom");
      expect(err.message).toBe("git op failed in /tmp/repo: boom");
      expect(err.name).toBe("GitError");
    });

    it("uses the Error's message when the cause is an Error instance", () => {
      const err = new GitError("op", "/tmp/repo", new Error("underlying failure"));
      expect(err.message).toBe("git op failed in /tmp/repo: underlying failure");
    });
  });

  describe("commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare-cp-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("commits and pushes changes when the worktree is on the expected branch", async () => {
      const wtPath = join(repoPath, ".worktrees", "cp-wt");
      await svc.createWorktree(repoPath, wtPath, "cp-branch", "main");
      writeFileSync(join(wtPath, "new.txt"), "hello");

      await svc.commitAndPush(wtPath, "cp-branch", "add new file");

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("refs/heads/cp-branch");

      await svc.removeWorktree(repoPath, wtPath);
    });

    it("throws BranchMismatchError and never pushes when the worktree is on the wrong branch", async () => {
      const wtPath = join(repoPath, ".worktrees", "cp-wt2");
      await svc.createWorktree(repoPath, wtPath, "cp-branch2", "main");
      writeFileSync(join(wtPath, "new.txt"), "hello");

      await expect(svc.commitAndPush(wtPath, "wrong-branch", "msg")).rejects.toThrow(
        BranchMismatchError,
      );

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).not.toContain("refs/heads/wrong-branch");

      await svc.removeWorktree(repoPath, wtPath);
    });
  });

  describe("setupRunWorktree additional branches", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare2-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("removes a pre-existing worktree at the deterministic path before recreating it", async () => {
      const runId = "12345678-0000-0000-0000-000000000000";
      const branchName = "hidday/pry-300-preexisting-path";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const worktreePath = join(repoPath, ".worktrees", dirName);

      // Simulate a stale leftover worktree occupying the deterministic path
      // from a crashed prior run.
      await svc.createWorktree(repoPath, worktreePath, "placeholder-branch", "main");
      expect(existsSync(worktreePath)).toBe(true);

      const warnSpy = vi.fn();
      const svc2 = new GitService({ ...noopLogger, warn: warnSpy });

      const result = await svc2.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(await svc2.currentBranch(worktreePath)).toBe(branchName);
      expect(warnSpy).toHaveBeenCalledWith(
        { worktreePath },
        "Worktree path already exists, removing first",
      );

      await svc2.removeWorktree(repoPath, worktreePath);
    });

    it("warns but still succeeds when origin/<branch> already exists", async () => {
      const branchName = "hidday/pry-400-existing-remote";
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);
      git(["branch", "-D", branchName], repoPath);

      const warnSpy = vi.fn();
      const svc2 = new GitService({ ...noopLogger, warn: warnSpy });

      const runId = "cafebabe-0000-0000-0000-000000000000";
      const result = await svc2.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc2.currentBranch(result.worktreePath)).toBe(branchName);
      expect(warnSpy).toHaveBeenCalledWith(
        { repoPath, branchName },
        expect.stringContaining("origin/<branch> already exists"),
      );

      await svc2.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
