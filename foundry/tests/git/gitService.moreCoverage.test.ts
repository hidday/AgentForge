import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-more-test-"));
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

describe("GitService - additional branch coverage", () => {
  let repoPath: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    svc = new GitService(noopLogger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe("fetch", () => {
    it("throws GitError when the repo has no usable origin remote", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
      await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed/);
    });
  });

  describe("createWorktree", () => {
    it("throws GitError when the underlying git command fails", async () => {
      await expect(
        svc.createWorktree(repoPath, join(repoPath, ".worktrees", "bad"), "x", "does-not-exist"),
      ).rejects.toThrow(GitError);
    });
  });

  describe("pruneWorktrees", () => {
    it("does not throw even when the git command fails (best-effort cleanup)", async () => {
      const bogusRepo = mkdtempSync(join(tmpdir(), "gitservice-more-notrepo-prune-"));
      try {
        await expect(svc.pruneWorktrees(bogusRepo)).resolves.toBeUndefined();
      } finally {
        rmSync(bogusRepo, { recursive: true, force: true });
      }
    });
  });

  describe("findWorktreeForBranch", () => {
    it("throws GitError when the underlying git command fails", async () => {
      const bogusRepo = mkdtempSync(join(tmpdir(), "gitservice-more-notrepo-"));
      try {
        await expect(svc.findWorktreeForBranch(bogusRepo, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(bogusRepo, { recursive: true, force: true });
      }
    });
  });

  describe("remoteBranchExists", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-more-bare-"));
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
      git(["push", "origin", "main:refs/heads/already-exists"], repoPath);
      git(["fetch", "origin"], repoPath);

      expect(await svc.remoteBranchExists(repoPath, "already-exists")).toBe(true);
    });
  });

  describe("removeWorktree", () => {
    it("does not throw when the target path is not a registered worktree (best-effort cleanup)", async () => {
      const notAWorktree = join(repoPath, "just-a-folder");
      mkdirSync(notAWorktree);
      await expect(svc.removeWorktree(repoPath, notAWorktree)).resolves.toBeUndefined();
    });
  });

  describe("hasChanges", () => {
    it("throws GitError when the underlying git command fails", async () => {
      await expect(svc.hasChanges("/path/does/not/exist")).rejects.toThrow(GitError);
    });
  });

  describe("commitAll", () => {
    it("throws GitError when the underlying git command fails", async () => {
      await expect(svc.commitAll("/path/does/not/exist", "msg")).rejects.toThrow(GitError);
      await expect(svc.commitAll("/path/does/not/exist", "msg")).rejects.toThrow(/git commit failed/);
    });
  });

  describe("push", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-more-push-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("pushes the current branch to origin successfully", async () => {
      git(["checkout", "-b", "feature/push-me"], repoPath);
      writeFileSync(join(repoPath, "new-file.txt"), "content");
      git(["add", "-A"], repoPath);
      git(["commit", "-m", "add new file"], repoPath);

      await expect(svc.push(repoPath, "feature/push-me")).resolves.toBeUndefined();

      const branches = git(["branch", "--list", "feature/push-me"], bareDir);
      expect(branches).toContain("feature/push-me");
    });

    it("throws GitError when there is no origin remote configured", async () => {
      git(["remote", "remove", "origin"], repoPath);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(/git push failed/);
    });
  });

  describe("commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-more-candp-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("asserts the branch, commits all changes, and pushes to origin end to end", async () => {
      git(["checkout", "-b", "feature/full-flow"], repoPath);
      writeFileSync(join(repoPath, "work.txt"), "work in progress");

      await svc.commitAndPush(repoPath, "feature/full-flow", "do the work");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("do the work");
      const remoteBranches = git(["branch", "--list", "feature/full-flow"], bareDir);
      expect(remoteBranches).toContain("feature/full-flow");
    });

    it("rejects with BranchMismatchError and never pushes when on the wrong branch", async () => {
      git(["checkout", "-b", "feature/wrong-branch"], repoPath);
      writeFileSync(join(repoPath, "work.txt"), "work in progress");

      await expect(
        svc.commitAndPush(repoPath, "feature/expected-branch", "do the work"),
      ).rejects.toThrow(/Branch safety check failed/);

      // Nothing should have been pushed since assertBranch failed first.
      const remoteBranches = git(["branch", "--list", "feature/expected-branch"], bareDir);
      expect(remoteBranches).toBe("");
    });
  });

  describe("setupRunWorktree: pre-existing worktree path", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-more-setup-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("removes and recreates the worktree when an empty directory already sits at the computed path", async () => {
      const runId = "11112222-3333-4444-5555-666677778888";
      const branchName = "hidday/pry-55-preexisting-path";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const expectedPath = join(repoPath, ".worktrees", dirName);

      // Simulate a leftover plain directory (not a registered git worktree) at
      // the exact path setupRunWorktree will compute.
      mkdirSync(expectedPath, { recursive: true });
      expect(existsSync(expectedPath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(expectedPath);
      expect(existsSync(join(expectedPath, ".git"))).toBe(true);
      expect(await svc.currentBranch(expectedPath)).toBe(branchName);

      await svc.removeWorktree(repoPath, expectedPath);
    });

    it("warns but still succeeds when origin/<branch> already exists", async () => {
      const branchName = "hidday/pry-56-already-on-origin";
      git(["checkout", "-b", branchName], repoPath);
      git(["push", "origin", `${branchName}:refs/heads/${branchName}`], repoPath);
      git(["checkout", "main"], repoPath);
      git(["fetch", "origin"], repoPath);

      const runId = "99998888-3333-4444-5555-666677778888";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
