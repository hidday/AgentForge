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

function makeSpyLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return logger;
}

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

    it("throws GitError when the target directory is not a git repository", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-notrepo-"));
      try {
        await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  });

  describe("fetch", () => {
    it("throws GitError when no origin remote is configured", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
      await expect(svc.fetch(repoPath)).rejects.toThrow(/fetch failed/);
    });
  });

  describe("createWorktree error handling", () => {
    it("throws GitError when the start point does not exist", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-start-wt");
      await expect(
        svc.createWorktree(repoPath, wtPath, "bad-branch", "does-not-exist-anywhere"),
      ).rejects.toThrow(GitError);
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("pruneWorktrees", () => {
    it("does not throw when the repo path is invalid (best-effort cleanup)", async () => {
      const logger = makeSpyLogger();
      const bestEffortSvc = new GitService(logger);
      await expect(bestEffortSvc.pruneWorktrees("/nonexistent-repo-path")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: "/nonexistent-repo-path" }),
        expect.stringContaining("Failed to prune worktrees"),
      );
    });
  });

  describe("findWorktreeForBranch error handling", () => {
    it("throws GitError for an invalid repo path", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent-repo-path", "main")).rejects.toThrow(
        GitError,
      );
    });
  });

  describe("removeWorktree best-effort cleanup", () => {
    it("does not throw and logs a warning when the path is not a registered worktree", async () => {
      const logger = makeSpyLogger();
      const bestEffortSvc = new GitService(logger);
      const notAWorktree = join(repoPath, "not-a-worktree");
      await expect(bestEffortSvc.removeWorktree(repoPath, notAWorktree)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, worktreePath: notAWorktree }),
        expect.stringContaining("Failed to remove worktree"),
      );
    });
  });

  describe("hasChanges error handling", () => {
    it("throws GitError for an invalid repo path", async () => {
      await expect(svc.hasChanges("/nonexistent-repo-path")).rejects.toThrow(GitError);
    });
  });

  describe("push / commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("push() pushes the branch to origin", async () => {
      await svc.push(repoPath, "main");
      const bareLog = git(["log", "--oneline", "main"], bareDir);
      const localLog = git(["log", "--oneline"], repoPath);
      expect(bareLog).toBe(localLog);
    });

    it("push() throws GitError when the remote rejects the push", async () => {
      // Remove the remote-tracking branch's ability to fast-forward by making the
      // bare repo's main diverge, then attempt a push that can't fast-forward.
      const otherClone = mkdtempSync(join(tmpdir(), "gitservice-otherclone-"));
      try {
        git(["clone", bareDir, otherClone], tmpdir());
        git(["config", "user.email", "test@test.com"], otherClone);
        git(["config", "user.name", "Test"], otherClone);
        writeFileSync(join(otherClone, "divergent.txt"), "divergent change");
        git(["add", "."], otherClone);
        git(["commit", "-m", "divergent commit"], otherClone);
        git(["push", "origin", "main"], otherClone);

        writeFileSync(join(repoPath, "local-only.txt"), "local change");
        git(["add", "."], repoPath);
        git(["commit", "-m", "local commit"], repoPath);

        await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(otherClone, { recursive: true, force: true });
      }
    });

    it("commitAndPush() commits pending changes and pushes them to origin", async () => {
      writeFileSync(join(repoPath, "new-file.txt"), "new content");
      await svc.commitAndPush(repoPath, "main", "commit via commitAndPush");

      const localLog = git(["log", "--oneline"], repoPath);
      expect(localLog).toContain("commit via commitAndPush");
      expect(await svc.hasChanges(repoPath)).toBe(false);

      const bareLog = git(["log", "--oneline", "main"], bareDir);
      expect(bareLog).toContain("commit via commitAndPush");
    });

    it("commitAndPush() throws BranchMismatchError without committing or pushing when on the wrong branch", async () => {
      git(["checkout", "-b", "other"], repoPath);
      writeFileSync(join(repoPath, "stray.txt"), "stray content");

      await expect(svc.commitAndPush(repoPath, "main", "should not land")).rejects.toThrow(
        BranchMismatchError,
      );

      // The change must remain uncommitted, and origin must not have received it.
      expect(await svc.hasChanges(repoPath)).toBe(true);
      const bareLog = git(["log", "--oneline", "main"], bareDir);
      expect(bareLog).not.toContain("should not land");
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

    it("removes a leftover worktree already at the deterministic target path before recreating it", async () => {
      const runId = "12345678-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-leftover-path";
      const dirName = buildWorktreeDirName(runId.slice(0, 8), branchName);
      const targetPath = join(repoPath, ".worktrees", dirName);

      // Simulate a leftover worktree occupying the exact deterministic path,
      // registered under a throwaway branch (distinct from the run's branch).
      await svc.createWorktree(repoPath, targetPath, "throwaway-leftover-branch", "main");
      expect(existsSync(targetPath)).toBe(true);

      const logger = makeSpyLogger();
      const spiedSvc = new GitService(logger);
      const result = await spiedSvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(targetPath);
      expect(await spiedSvc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ worktreePath: targetPath }),
        "Worktree path already exists, removing first",
      );

      await spiedSvc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns but continues when origin/<branch> already exists remotely", async () => {
      const branchName = "hidday/pry-201-existing-remote";
      // Simulate the remote branch already existing (e.g. from a previous attempt)
      // by pushing the current main HEAD to origin under this branch name.
      git(["push", "origin", `main:refs/heads/${branchName}`], repoPath);

      const runId = "cafebabe-3456-7890-abcd-ef1234567890";
      const logger = makeSpyLogger();
      const spiedSvc = new GitService(logger);
      const result = await spiedSvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await spiedSvc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, branchName }),
        expect.stringContaining("origin/<branch> already exists"),
      );

      await spiedSvc.removeWorktree(repoPath, result.worktreePath);
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

    it("stops adding slug parts once the cumulative length would exceed 30 characters", () => {
      const word1 = "a".repeat(20);
      const word2 = "b".repeat(15);
      // word1 alone fits (20 chars); word1 + "-" + word2 would be 36 chars, over
      // the 30-char cap, so shortenSlug should stop after word1.
      expect(buildWorktreeDirName("abcdefgh", `pry-1-${word1}-${word2}`)).toBe(
        `run-abcdefgh-pry-1-${word1}`,
      );
    });
  });

  describe("GitError", () => {
    it("stringifies a non-Error cause via String() instead of reading .message", () => {
      const err = new GitError("test-op", "/tmp/somewhere", "a plain string reason");
      expect(err.name).toBe("GitError");
      expect(err.message).toBe("git test-op failed in /tmp/somewhere: a plain string reason");
    });

    it("uses an Error cause's message directly", () => {
      const err = new GitError("test-op", "/tmp/somewhere", new Error("underlying failure"));
      expect(err.message).toBe("git test-op failed in /tmp/somewhere: underlying failure");
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
});
