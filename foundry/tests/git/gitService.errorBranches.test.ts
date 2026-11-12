import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-errbr-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: (): unknown => logger,
  };
  return logger;
}

describe("GitService — error-catch branches on failing git commands", () => {
  let repoPath: string;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    logger = makeLogger();
    svc = new GitService(logger as never);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe("fetch (lines 89-90)", () => {
    it("throws a GitError wrapping the underlying failure when there is no 'origin' remote configured", async () => {
      // No `git remote add origin ...` was run, so `git fetch origin --prune`
      // fails with a real git error (not a mock).
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
      await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed in/);
    });
  });

  describe("createWorktree (lines 116-117)", () => {
    it("throws a GitError when the requested branch name already exists and resetIfExists is not set", async () => {
      // "-b" (not "-B") fails outright when the branch already exists.
      git(["branch", "dup-branch"], repoPath);
      const wtPath = join(repoPath, ".worktrees", "dup-wt");

      await expect(
        svc.createWorktree(repoPath, wtPath, "dup-branch", "main"),
      ).rejects.toThrow(GitError);
      await expect(
        svc.createWorktree(repoPath, wtPath, "dup-branch", "main"),
      ).rejects.toThrow(/worktree add failed in/);
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("pruneWorktrees (lines 125-129)", () => {
    it("logs a warning and resolves (does not throw) when the underlying git command fails", async () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "gitservice-notrepo-"));
      try {
        await expect(svc.pruneWorktrees(nonGitDir)).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ repoPath: nonGitDir, error: expect.any(String) }),
          "Failed to prune worktrees (best-effort cleanup)",
        );
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe("findWorktreeForBranch (lines 141-142)", () => {
    it("throws a GitError when `git worktree list` fails (not a git repository)", async () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "gitservice-notrepo2-"));
      try {
        await expect(svc.findWorktreeForBranch(nonGitDir, "whatever")).rejects.toThrow(GitError);
        await expect(svc.findWorktreeForBranch(nonGitDir, "whatever")).rejects.toThrow(
          /worktree list failed in/,
        );
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe("removeWorktree (lines 171-175)", () => {
    it("logs a warning and resolves (does not throw) when the worktree path does not exist", async () => {
      const bogusPath = join(repoPath, ".worktrees", "never-created");
      await expect(svc.removeWorktree(repoPath, bogusPath)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath,
          worktreePath: bogusPath,
          error: expect.any(String),
        }),
        "Failed to remove worktree (best-effort cleanup)",
      );
    });
  });

  describe("hasChanges (lines 199-200)", () => {
    it("throws a GitError when `git status` fails (not a git repository)", async () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "gitservice-notrepo3-"));
      try {
        await expect(svc.hasChanges(nonGitDir)).rejects.toThrow(GitError);
        await expect(svc.hasChanges(nonGitDir)).rejects.toThrow(/status failed in/);
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe("commitAll (lines 214-215)", () => {
    it("throws a GitError when the underlying git command fails mid-sequence", async () => {
      // A stale index.lock makes every subsequent git command in the working
      // tree fail with a real, non-mocked git error ("Unable to create
      // '.git/index.lock': File exists."), which commitAll's catch wraps.
      writeFileSync(join(repoPath, ".git", "index.lock"), "");
      writeFileSync(join(repoPath, "new-file.txt"), "content");

      await expect(svc.commitAll(repoPath, "a commit message")).rejects.toThrow(GitError);
      await expect(svc.commitAll(repoPath, "a commit message")).rejects.toThrow(
        /commit failed in/,
      );
    });
  });

  describe("push (lines 223-224)", () => {
    it("throws a GitError wrapping the underlying failure when there is no 'origin' remote configured", async () => {
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(/git push failed in/);
    });
  });

  describe("commitAndPush (lines 228-231)", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-errbr-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("asserts the branch, commits all changes, and pushes to origin in sequence", async () => {
      git(["checkout", "-b", "feature/commit-and-push"], repoPath);
      writeFileSync(join(repoPath, "feature.txt"), "feature content");

      await svc.commitAndPush(repoPath, "feature/commit-and-push", "add feature");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("add feature");
      expect(await svc.hasChanges(repoPath)).toBe(false);

      // Verify the push actually landed on the bare "remote".
      const remoteBranches = execFileSync("git", ["branch"], {
        cwd: bareDir,
        encoding: "utf-8",
      });
      expect(remoteBranches).toContain("feature/commit-and-push");
    });

    it("propagates BranchMismatchError from assertBranch without committing or pushing", async () => {
      // Still on "main", but we assert against a different expected branch.
      writeFileSync(join(repoPath, "unexpected.txt"), "should not be committed");

      await expect(
        svc.commitAndPush(repoPath, "some-other-branch", "should not happen"),
      ).rejects.toThrow(/Branch safety check failed/);

      // Nothing was committed because assertBranch failed before commitAll ran.
      expect(await svc.hasChanges(repoPath)).toBe(true);
    });
  });
});
