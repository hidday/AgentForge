import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
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

    it("removes a leftover directory already sitting at the deterministic worktree path before creating fresh", async () => {
      const runId = "cafebabe-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-leftover-dir";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const worktreePath = join(repoPath, ".worktrees", dirName);
      mkdirSync(worktreePath, { recursive: true });
      expect(existsSync(worktreePath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(existsSync(worktreePath)).toBe(true);
      expect(await svc.currentBranch(worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists on the remote", async () => {
      const branchName = "hidday/pry-300-already-pushed";
      const runId1 = "11111111-3456-7890-abcd-ef1234567890";

      // First run: create the worktree, commit, and push so origin/<branch> exists.
      const first = await svc.setupRunWorktree(repoPath, runId1, "main", branchName);
      writeFileSync(join(first.worktreePath, "extra.txt"), "content");
      await svc.commitAll(first.worktreePath, "extra commit");
      await svc.push(first.worktreePath, branchName);
      await svc.removeWorktree(repoPath, first.worktreePath);

      expect(await svc.remoteBranchExists(repoPath, branchName)).toBe(true);

      // Second run reuses the same branch name; origin/<branch> already exists.
      const runId2 = "22222222-3456-7890-abcd-ef1234567890";
      const second = await svc.setupRunWorktree(repoPath, runId2, "main", branchName);

      expect(existsSync(second.worktreePath)).toBe(true);
      expect(await svc.currentBranch(second.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, second.worktreePath);
    });
  });

  describe("remoteBranchExists", () => {
    it("returns false when origin/<branch> does not exist", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare-rbe-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);

      expect(await svc.remoteBranchExists(repoPath, "does-not-exist")).toBe(false);

      rmSync(bareDir, { recursive: true, force: true });
    });
  });

  describe("push / commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare-push-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("push pushes the branch to origin and it becomes visible there", async () => {
      const wtPath = join(repoPath, ".worktrees", "push-wt");
      await svc.createWorktree(repoPath, wtPath, "push-branch", "main");
      writeFileSync(join(wtPath, "pushed.txt"), "hello");
      await svc.commitAll(wtPath, "pushed commit");

      await svc.push(wtPath, "push-branch");

      const remoteBranches = git(["branch", "--list", "push-branch"], bareDir);
      expect(remoteBranches).toContain("push-branch");

      await svc.removeWorktree(repoPath, wtPath);
    });

    it("push throws GitError when origin is not configured", async () => {
      // A fresh repo (no `origin` remote added), distinct from the outer `repoPath`
      // which this describe block's beforeEach already points at `origin`.
      const noRemoteRepo = createTestRepo();
      await expect(svc.push(noRemoteRepo, "main")).rejects.toThrow(GitError);
      rmSync(noRemoteRepo, { recursive: true, force: true });
    });

    it("commitAndPush commits and pushes when on the expected branch", async () => {
      const wtPath = join(repoPath, ".worktrees", "combo-wt");
      await svc.createWorktree(repoPath, wtPath, "combo-branch", "main");
      writeFileSync(join(wtPath, "combo.txt"), "hello");

      await svc.commitAndPush(wtPath, "combo-branch", "combo commit");

      const log = git(["log", "--oneline"], wtPath);
      expect(log).toContain("combo commit");
      const remoteBranches = git(["branch", "--list", "combo-branch"], bareDir);
      expect(remoteBranches).toContain("combo-branch");

      await svc.removeWorktree(repoPath, wtPath);
    });

    it("commitAndPush throws BranchMismatchError and does not push when on the wrong branch", async () => {
      const wtPath = join(repoPath, ".worktrees", "mismatch-wt");
      await svc.createWorktree(repoPath, wtPath, "actual-branch", "main");
      writeFileSync(join(wtPath, "x.txt"), "hello");

      await expect(
        svc.commitAndPush(wtPath, "expected-branch", "should not happen"),
      ).rejects.toThrow(BranchMismatchError);

      const remoteBranches = git(["branch", "--list", "expected-branch"], bareDir);
      expect(remoteBranches).toBe("");

      await svc.removeWorktree(repoPath, wtPath);
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

    it("stops mid-slug when appending the next word would exceed the 30-char length cap", () => {
      const longWord = "b".repeat(31);
      const branchName = `eng-42-x-${longWord}`;
      // "x" (1 char) fits; appending the 31-char word would make "x-<word>" (33 chars)
      // exceed maxLen=30, so shortenSlug stops after "x" instead of the 4-word maxParts cap.
      expect(buildWorktreeDirName("abcdefgh", branchName)).toBe("run-abcdefgh-eng-42-x");
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

  describe("GitError", () => {
    it("stringifies a non-Error cause instead of reading .message", () => {
      const err = new GitError("fetch", "/some/repo", "a plain string failure");
      expect(err.message).toBe("git fetch failed in /some/repo: a plain string failure");
      expect(err.name).toBe("GitError");
    });

    it("uses the .message of an Error cause", () => {
      const err = new GitError("fetch", "/some/repo", new Error("boom"));
      expect(err.message).toBe("git fetch failed in /some/repo: boom");
    });
  });

  describe("error handling", () => {
    it("throws GitError for invalid repo path", async () => {
      await expect(svc.currentBranch("/nonexistent")).rejects.toThrow(GitError);
    });

    it("fetch throws GitError when the repo path is not a git repository", async () => {
      const plainDir = mkdtempSync(join(tmpdir(), "gitservice-plain-"));
      await expect(svc.fetch(plainDir)).rejects.toThrow(GitError);
      rmSync(plainDir, { recursive: true, force: true });
    });

    it("createWorktree throws GitError when the branch already exists (no resetIfExists)", async () => {
      const wtPath1 = join(repoPath, ".worktrees", "dupe-wt-1");
      await svc.createWorktree(repoPath, wtPath1, "dupe-branch", "main");

      const wtPath2 = join(repoPath, ".worktrees", "dupe-wt-2");
      await expect(svc.createWorktree(repoPath, wtPath2, "dupe-branch", "main")).rejects.toThrow(
        GitError,
      );

      await svc.removeWorktree(repoPath, wtPath1);
    });

    it("hasChanges throws GitError for an invalid repo path", async () => {
      const plainDir = mkdtempSync(join(tmpdir(), "gitservice-plain-"));
      await expect(svc.hasChanges(plainDir)).rejects.toThrow(GitError);
      rmSync(plainDir, { recursive: true, force: true });
    });

    it("commitAll throws GitError when `git add` fails", async () => {
      const plainDir = mkdtempSync(join(tmpdir(), "gitservice-plain-"));
      await expect(svc.commitAll(plainDir, "msg")).rejects.toThrow(GitError);
      rmSync(plainDir, { recursive: true, force: true });
    });

    it("findWorktreeForBranch throws GitError for an invalid repo path", async () => {
      const plainDir = mkdtempSync(join(tmpdir(), "gitservice-plain-"));
      await expect(svc.findWorktreeForBranch(plainDir, "any")).rejects.toThrow(GitError);
      rmSync(plainDir, { recursive: true, force: true });
    });

    it("pruneWorktrees logs a warning and does not throw when git fails (best-effort)", async () => {
      const warn = vi.fn();
      const spyLogger = { ...noopLogger, warn };
      const spySvc = new GitService(spyLogger);
      const plainDir = mkdtempSync(join(tmpdir(), "gitservice-plain-"));

      await expect(spySvc.pruneWorktrees(plainDir)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: plainDir }),
        expect.stringContaining("Failed to prune worktrees"),
      );

      rmSync(plainDir, { recursive: true, force: true });
    });

    it("removeWorktree logs a warning and does not throw when the worktree does not exist (best-effort)", async () => {
      const warn = vi.fn();
      const spyLogger = { ...noopLogger, warn };
      const spySvc = new GitService(spyLogger);
      const missingPath = join(repoPath, ".worktrees", "never-existed");

      await expect(spySvc.removeWorktree(repoPath, missingPath)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, worktreePath: missingPath }),
        expect.stringContaining("Failed to remove worktree"),
      );
    });
  });
});
