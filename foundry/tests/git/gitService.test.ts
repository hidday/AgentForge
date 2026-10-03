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
  });

  describe("fetch", () => {
    it("throws GitError when the repo has no such remote", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });

    it("succeeds and logs when a remote exists", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-fetch-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      await expect(svc.fetch(repoPath)).resolves.toBeUndefined();
      rmSync(bareDir, { recursive: true, force: true });
    });
  });

  describe("createWorktree error handling", () => {
    it("throws GitError when the start point does not exist", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-wt");
      await expect(
        svc.createWorktree(repoPath, wtPath, "feature-x", "origin/does-not-exist"),
      ).rejects.toThrow(GitError);
    });
  });

  describe("pruneWorktrees", () => {
    it("resolves without throwing on a healthy repo", async () => {
      await expect(svc.pruneWorktrees(repoPath)).resolves.toBeUndefined();
    });

    it("warns instead of throwing when the git command fails", async () => {
      const warnings: unknown[][] = [];
      const warnLogger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnings.push(args),
      };
      const failSvc = new GitService(warnLogger as never);
      await expect(failSvc.pruneWorktrees("/nonexistent")).resolves.toBeUndefined();
      expect(warnings.length).toBe(1);
    });
  });

  describe("removeWorktree error handling", () => {
    it("warns instead of throwing when the worktree does not exist", async () => {
      const warnings: unknown[][] = [];
      const warnLogger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnings.push(args),
      };
      const failSvc = new GitService(warnLogger as never);
      await expect(
        failSvc.removeWorktree(repoPath, join(repoPath, ".worktrees", "nope")),
      ).resolves.toBeUndefined();
      expect(warnings.length).toBe(1);
    });
  });

  describe("remoteBranchExists", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-remote-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("returns true when origin/<branch> exists", async () => {
      expect(await svc.remoteBranchExists(repoPath, "main")).toBe(true);
    });

    it("returns false when origin/<branch> does not exist", async () => {
      expect(await svc.remoteBranchExists(repoPath, "nonexistent-branch")).toBe(false);
    });
  });

  describe("push", () => {
    it("throws GitError when there is no configured remote to push to", async () => {
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
    });

    it("pushes successfully to a configured remote", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);

      await expect(svc.push(repoPath, "main")).resolves.toBeUndefined();

      const branches = git(["branch", "-a"], bareDir);
      expect(branches).toContain("main");
      rmSync(bareDir, { recursive: true, force: true });
    });
  });

  describe("commitAndPush", () => {
    it("asserts the branch, commits, and pushes in sequence", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-candp-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      writeFileSync(join(repoPath, "newfile.txt"), "content");

      await svc.commitAndPush(repoPath, "main", "add newfile");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("add newfile");
      const remoteLog = git(["log", "--oneline", "main"], bareDir);
      expect(remoteLog).toContain("add newfile");
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("throws BranchMismatchError and never pushes when on the wrong branch", async () => {
      git(["checkout", "-b", "other"], repoPath);
      await expect(svc.commitAndPush(repoPath, "main", "msg")).rejects.toThrow(
        BranchMismatchError,
      );
    });
  });

  describe("commitAll error handling", () => {
    it("throws GitError when the working directory is not a git repo", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-notrepo-"));
      await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(GitError);
      rmSync(notARepo, { recursive: true, force: true });
    });
  });
});
