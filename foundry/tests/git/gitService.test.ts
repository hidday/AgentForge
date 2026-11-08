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

    it("throws GitError when the path is not a git repository", async () => {
      await expect(svc.hasChanges("/nonexistent")).rejects.toThrow(GitError);
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

    it("throws GitError when the path is not a git repository", async () => {
      await expect(svc.commitAll("/nonexistent", "test commit")).rejects.toThrow(GitError);
    });
  });

  describe("push / commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("push publishes a new local branch to origin", async () => {
      git(["checkout", "-b", "feature/push-me"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      git(["add", "."], repoPath);
      git(["commit", "-m", "add pushed file"], repoPath);

      await svc.push(repoPath, "feature/push-me");

      // Verify origin now has the branch by fetching it fresh into a clone.
      const checkoutDir = mkdtempSync(join(tmpdir(), "gitservice-push-check-"));
      try {
        git(["clone", bareDir, checkoutDir], tmpdir());
        const remoteBranches = git(["branch", "-r"], checkoutDir);
        expect(remoteBranches).toContain("origin/feature/push-me");
      } finally {
        rmSync(checkoutDir, { recursive: true, force: true });
      }
    });

    it("push throws GitError when origin is unreachable", async () => {
      git(["remote", "set-url", "origin", "/nonexistent/path.git"], repoPath);
      git(["checkout", "-b", "feature/will-fail"], repoPath);

      await expect(svc.push(repoPath, "feature/will-fail")).rejects.toThrow(GitError);
    });

    it("commitAndPush asserts the branch, commits pending changes, and pushes", async () => {
      git(["checkout", "-b", "feature/combo"], repoPath);
      writeFileSync(join(repoPath, "combo.txt"), "combo content");

      await svc.commitAndPush(repoPath, "feature/combo", "combo commit");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("combo commit");
      expect(await svc.hasChanges(repoPath)).toBe(false);

      const checkoutDir = mkdtempSync(join(tmpdir(), "gitservice-combo-check-"));
      try {
        git(["clone", bareDir, checkoutDir], tmpdir());
        const remoteBranches = git(["branch", "-r"], checkoutDir);
        expect(remoteBranches).toContain("origin/feature/combo");
      } finally {
        rmSync(checkoutDir, { recursive: true, force: true });
      }
    });

    it("commitAndPush throws BranchMismatchError without pushing when on the wrong branch", async () => {
      git(["checkout", "-b", "feature/wrong"], repoPath);

      await expect(
        svc.commitAndPush(repoPath, "feature/expected", "should not push"),
      ).rejects.toThrow(BranchMismatchError);
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

    it("throws GitError when the branch already exists and resetIfExists is not set", async () => {
      git(["branch", "dup-branch"], repoPath);
      const wtPath = join(repoPath, ".worktrees", "dup-wt");

      await expect(svc.createWorktree(repoPath, wtPath, "dup-branch", "main")).rejects.toThrow(
        GitError,
      );
    });

    it("removeWorktree removes the worktree", async () => {
      const wtPath = join(repoPath, ".worktrees", "test-wt2");
      await svc.createWorktree(repoPath, wtPath, "branch2", "main");
      expect(existsSync(wtPath)).toBe(true);

      await svc.removeWorktree(repoPath, wtPath);
      expect(existsSync(wtPath)).toBe(false);
    });

    it("removeWorktree logs a warning and does not throw when the path is not a registered worktree", async () => {
      const warn = vi.fn();
      const spiedSvc = new GitService({ ...noopLogger, warn } as never);
      const bogusPath = join(repoPath, ".worktrees", "not-a-real-worktree");

      await expect(spiedSvc.removeWorktree(repoPath, bogusPath)).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, worktreePath: bogusPath }),
        "Failed to remove worktree (best-effort cleanup)",
      );
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

    it("removes a pre-existing directory at the computed worktree path before recreating it", async () => {
      const warn = vi.fn();
      const spiedSvc = new GitService({ ...noopLogger, warn } as never);

      const runId = "aaaaaaaa-0000-0000-0000-000000000000";
      const branchName = "hidday/pry-55-existing-path";
      const dirName = buildWorktreeDirName(runId.slice(0, 8), branchName);
      const worktreePath = join(repoPath, ".worktrees", dirName);

      // Simulate a leftover directory sitting exactly at the path
      // setupRunWorktree will compute, checked out on an unrelated branch.
      await svc.createWorktree(repoPath, worktreePath, "leftover-branch", "main");
      expect(existsSync(worktreePath)).toBe(true);

      const result = await spiedSvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(await spiedSvc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(warn).toHaveBeenCalledWith(
        { worktreePath },
        "Worktree path already exists, removing first",
      );

      await spiedSvc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns when origin/<branch> already exists and resets the local branch to startPoint", async () => {
      const warn = vi.fn();
      const spiedSvc = new GitService({ ...noopLogger, warn } as never);

      const branchName = "hidday/pry-77-existing-remote";
      // Push the branch to origin first so `origin/<branchName>` already exists.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);

      const runId = "cccccccc-0000-0000-0000-000000000000";
      const result = await spiedSvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await spiedSvc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(warn).toHaveBeenCalledWith(
        { repoPath, branchName },
        expect.stringContaining("origin/<branch> already exists"),
      );

      await spiedSvc.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("pruneWorktrees", () => {
    it("logs a warning and does not throw when the repo path is invalid", async () => {
      const warn = vi.fn();
      const spiedSvc = new GitService({ ...noopLogger, warn } as never);

      await expect(spiedSvc.pruneWorktrees("/nonexistent")).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: "/nonexistent" }),
        "Failed to prune worktrees (best-effort cleanup)",
      );
    });
  });

  describe("findWorktreeForBranch", () => {
    it("returns null when no worktree has the branch", async () => {
      expect(await svc.findWorktreeForBranch(repoPath, "nope")).toBeNull();
    });

    it("throws GitError when the path is not a git repository", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent", "nope")).rejects.toThrow(GitError);
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
  });

  describe("fetch", () => {
    it("throws GitError when there is no origin remote to fetch from", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });
  });
});
