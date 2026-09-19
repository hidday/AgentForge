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

    it("fetch throws GitError when the operation fails", async () => {
      // repoPath has no "origin" remote configured, so `git fetch origin` fails.
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });

    it("createWorktree throws GitError when the operation fails", async () => {
      // Non-existent start point makes `git worktree add` fail.
      await expect(
        svc.createWorktree(repoPath, join(repoPath, ".worktrees", "bad"), "b1", "no-such-ref"),
      ).rejects.toThrow(GitError);
    });

    it("pruneWorktrees warns (does not throw) when the operation fails", async () => {
      await expect(svc.pruneWorktrees("/nonexistent")).resolves.toBeUndefined();
    });

    it("findWorktreeForBranch throws GitError when the operation fails", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent", "main")).rejects.toThrow(GitError);
    });

    it("removeWorktree warns (does not throw) when the operation fails", async () => {
      await expect(svc.removeWorktree(repoPath, "/nonexistent/path")).resolves.toBeUndefined();
    });

    it("hasChanges throws GitError when the operation fails", async () => {
      await expect(svc.hasChanges("/nonexistent")).rejects.toThrow(GitError);
    });

    it("commitAll throws GitError when the operation fails", async () => {
      await expect(svc.commitAll("/nonexistent", "msg")).rejects.toThrow(GitError);
    });
  });

  describe("push / commitAndPush", () => {
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

    it("push pushes the current branch to origin with -u", async () => {
      git(["checkout", "-b", "feature/push-me"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "hi");
      git(["add", "-A"], repoPath);
      git(["commit", "-m", "add pushed.txt"], repoPath);

      await svc.push(repoPath, "feature/push-me");

      const remoteBranches = git(["branch", "-r"], repoPath);
      expect(remoteBranches).toContain("origin/feature/push-me");
    });

    it("push throws GitError when the remote rejects it", async () => {
      // repoPath here has no "origin" remote at all, so push fails.
      const other = createTestRepo();
      try {
        await expect(svc.push(other, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });

    it("commitAndPush commits pending changes and pushes when on the expected branch", async () => {
      git(["checkout", "-b", "feature/commit-and-push"], repoPath);
      writeFileSync(join(repoPath, "new-file.txt"), "content");

      await svc.commitAndPush(repoPath, "feature/commit-and-push", "commit via commitAndPush");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("commit via commitAndPush");
      const remoteBranches = git(["branch", "-r"], repoPath);
      expect(remoteBranches).toContain("origin/feature/commit-and-push");
    });

    it("commitAndPush throws BranchMismatchError without committing or pushing when on the wrong branch", async () => {
      git(["checkout", "-b", "feature/actual-branch"], repoPath);
      writeFileSync(join(repoPath, "new-file.txt"), "content");

      await expect(
        svc.commitAndPush(repoPath, "feature/expected-branch", "should not commit"),
      ).rejects.toThrow(BranchMismatchError);

      expect(await svc.hasChanges(repoPath)).toBe(true);
      const remoteBranches = git(["branch", "-r"], repoPath);
      expect(remoteBranches).not.toContain("origin/feature/expected-branch");
    });
  });

  describe("setupRunWorktree additional branches", () => {
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

    it("removes a pre-existing worktree at the computed path before creating it", async () => {
      const runId = "12345678-0000-0000-0000-000000000000";
      const branchName = "hidday/pry-7-precreated-dir";
      const dirName = buildWorktreeDirName(runId.slice(0, 8), branchName);
      const worktreePath = join(repoPath, ".worktrees", dirName);

      // Pre-create a *real* git worktree at exactly the path setupRunWorktree will
      // use (on an unrelated branch), simulating a leftover from a crashed prior
      // run. `removeWorktree` only succeeds on git-registered worktrees, so a
      // plain directory wouldn't exercise this path the same way.
      await svc.createWorktree(repoPath, worktreePath, "leftover-branch", "main");
      expect(existsSync(worktreePath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(await svc.currentBranch(worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists", async () => {
      const branchName = "hidday/pry-8-remote-exists";
      // Push the branch to origin first, so remoteBranchExists(...) is true.
      git(["checkout", "-b", branchName], repoPath);
      git(["push", "-u", "origin", branchName], repoPath);
      git(["checkout", "main"], repoPath);

      const runId = "87654321-0000-0000-0000-000000000000";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(await svc.remoteBranchExists(repoPath, branchName)).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
