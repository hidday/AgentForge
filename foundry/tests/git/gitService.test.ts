import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
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

    it("throws GitError when the underlying git command fails", async () => {
      await expect(svc.hasChanges("/nonexistent-path-for-git")).rejects.toThrow(GitError);
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

    it("throws GitError when the underlying git command fails", async () => {
      await expect(svc.commitAll("/nonexistent-path-for-git", "msg")).rejects.toThrow(GitError);
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

    it("createWorktree throws GitError when the underlying git command fails", async () => {
      await expect(
        svc.createWorktree("/nonexistent-path-for-git", "/nonexistent-path-for-git/wt", "b", "main"),
      ).rejects.toThrow(GitError);
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

    it("removes a leftover empty directory already at the target worktree path before creating it", async () => {
      const runId = "11112222-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-leftover-dir";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const worktreePath = join(repoPath, ".worktrees", dirName);

      // Simulate a leftover (non-worktree) empty directory sitting at the
      // exact path setupRunWorktree will want to use.
      mkdirSync(worktreePath, { recursive: true });
      expect(existsSync(worktreePath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      // It must be a real worktree now (has a .git file), not the plain leftover dir.
      expect(readFileSync(join(result.worktreePath, ".git"), "utf-8")).toContain("gitdir:");

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists remotely", async () => {
      const branchName = "hidday/pry-300-remote-exists";
      // Create and push the branch to origin so remoteBranchExists() is true,
      // but leave no local branch or worktree record behind.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);
      git(["branch", "-D", branchName], repoPath);

      const runId = "33334444-3456-7890-abcd-ef1234567890";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("push / commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("push() pushes the current branch to origin and sets the upstream", async () => {
      git(["checkout", "-b", "push-me"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      git(["add", "."], repoPath);
      git(["commit", "-m", "add pushed file"], repoPath);

      await svc.push(repoPath, "push-me");

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("refs/heads/push-me");
    });

    it("push() throws a GitError when the remote push fails", async () => {
      // No "origin" remote configured, so the push has nothing to push to.
      const lonelyRepo = createTestRepo();
      try {
        await expect(svc.push(lonelyRepo, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(lonelyRepo, { recursive: true, force: true });
      }
    });

    it("commitAndPush() asserts the branch, commits pending changes, and pushes to origin", async () => {
      git(["checkout", "-b", "feature/full-cycle"], repoPath);
      writeFileSync(join(repoPath, "feature.txt"), "feature content");

      await svc.commitAndPush(repoPath, "feature/full-cycle", "Implement feature");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("Implement feature");
      expect(await svc.hasChanges(repoPath)).toBe(false);

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("refs/heads/feature/full-cycle");
    });

    it("commitAndPush() throws BranchMismatchError and never pushes when on the wrong branch", async () => {
      git(["checkout", "-b", "actual-branch"], repoPath);

      await expect(
        svc.commitAndPush(repoPath, "expected-branch", "Should not happen"),
      ).rejects.toThrow(BranchMismatchError);

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).not.toContain("refs/heads/expected-branch");
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

    it("throws GitError when the underlying git command fails", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent-path-for-git", "x")).rejects.toThrow(
        GitError,
      );
    });
  });

  describe("pruneWorktrees", () => {
    it("resolves without throwing even when the git command fails (best-effort)", async () => {
      await expect(svc.pruneWorktrees("/nonexistent-path-for-git")).resolves.toBeUndefined();
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

    it("truncates the slug mid-word when a single word already exceeds the 30-char limit", () => {
      // The first word alone is >30 chars, so shortenSlug must break out of
      // the accumulation loop via the length check rather than the part-count
      // check, leaving the slug empty (no word short enough to include).
      const longWord = "a".repeat(35);
      expect(buildWorktreeDirName("abcdefgh", `eng-1-${longWord}-rest-of-branch`)).toBe(
        "run-abcdefgh-eng-1",
      );
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

    it("fetch() throws GitError when the underlying git command fails", async () => {
      await expect(svc.fetch("/nonexistent-path-for-git")).rejects.toThrow(GitError);
    });

    it("GitError formats a non-Error cause via String() rather than reading .message", () => {
      const err = new GitError("fetch", "/tmp/repo", "a raw string failure, not an Error object");
      expect(err.message).toBe(
        "git fetch failed in /tmp/repo: a raw string failure, not an Error object",
      );
      expect(err.name).toBe("GitError");
    });
  });
});
