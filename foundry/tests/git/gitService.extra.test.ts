import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError } from "../../src/git/gitService.js";

// Additive coverage for gitService.ts failure paths and flows not exercised
// by gitService.test.ts: fetch/createWorktree/findWorktreeForBranch/hasChanges
// failures (GitError), pruneWorktrees/removeWorktree best-effort swallowing,
// push success/failure, commitAndPush end-to-end, remoteBranchExists' true
// branch, and setupRunWorktree's "leftover directory at worktreePath" branch.

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-extra-test-"));
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

describe("GitService (failure paths and additional flows)", () => {
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
    it("throws GitError when there is no origin remote configured", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });
  });

  describe("createWorktree", () => {
    it("throws GitError when the branch already exists and resetIfExists is not set", async () => {
      git(["branch", "already-exists"], repoPath);
      const wtPath = join(repoPath, ".worktrees", "dup");
      await expect(svc.createWorktree(repoPath, wtPath, "already-exists", "main")).rejects.toThrow(
        GitError,
      );
    });
  });

  describe("pruneWorktrees", () => {
    it("swallows failures and does not throw for an invalid repo path", async () => {
      await expect(svc.pruneWorktrees(join(repoPath, "does-not-exist"))).resolves.toBeUndefined();
    });
  });

  describe("findWorktreeForBranch", () => {
    it("throws GitError for a path that is not a git repository", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.findWorktreeForBranch(notARepo, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  });

  describe("removeWorktree", () => {
    it("swallows failures and does not throw when the path is not a registered worktree", async () => {
      const notAWorktree = join(repoPath, "not-a-worktree");
      mkdirSync(notAWorktree);
      await expect(svc.removeWorktree(repoPath, notAWorktree)).resolves.toBeUndefined();
    });
  });

  describe("hasChanges", () => {
    it("throws GitError for a path that is not a git repository", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.hasChanges(notARepo)).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  });

  describe("commitAll", () => {
    it("throws GitError when the working directory is not a git repository", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  });

  describe("remoteBranchExists / push / commitAndPush (with a real bare origin)", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-extra-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("remoteBranchExists returns true once the branch has been pushed", async () => {
      expect(await svc.remoteBranchExists(repoPath, "feature-x")).toBe(false);

      const wtPath = join(repoPath, ".worktrees", "feature-x");
      await svc.createWorktree(repoPath, wtPath, "feature-x", "main");
      await svc.push(wtPath, "feature-x");

      expect(await svc.remoteBranchExists(repoPath, "feature-x")).toBe(true);
      await svc.removeWorktree(repoPath, wtPath);
    });

    it("push throws GitError when origin is unreachable", async () => {
      git(["remote", "set-url", "origin", "/no/such/path/origin.git"], repoPath);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
    });

    it("commitAndPush asserts the branch, commits, and pushes to origin in one call", async () => {
      const wtPath = join(repoPath, ".worktrees", "full-flow");
      await svc.createWorktree(repoPath, wtPath, "full-flow", "main");
      writeFileSync(join(wtPath, "new-file.txt"), "hello");

      await svc.commitAndPush(wtPath, "full-flow", "add new-file.txt");

      const bareBranches = git(["branch", "-a"], bareDir);
      expect(bareBranches).toContain("full-flow");
      expect(await svc.hasChanges(wtPath)).toBe(false);

      await svc.removeWorktree(repoPath, wtPath);
    });

    it("setupRunWorktree warns and resets the local branch when origin/<branch> already exists", async () => {
      const branchName = "hidday/pry-200-already-on-origin";
      // Push the branch to origin first, then delete the local copy so
      // setupRunWorktree has to recreate it fresh from the (still-existing)
      // remote ref.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);
      git(["branch", "-D", branchName], repoPath);

      const runId = "faceb00c-3456-7890-abcd-ef1234567890";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.branchName).toBe(branchName);
      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.remoteBranchExists(repoPath, branchName)).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("setupRunWorktree removes a leftover worktree already registered at the target path", async () => {
      const runId = "0ddba11c-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-201-leftover-dir";
      const shortId = runId.slice(0, 8);

      // Pre-create a *different* branch's worktree at exactly the path
      // setupRunWorktree will compute for `branchName`, simulating a crashed
      // run whose worktree directory survived under a stale branch.
      const expectedDir = join(repoPath, ".worktrees", `run-${shortId}-pry-201-leftover-dir`);
      await svc.createWorktree(repoPath, expectedDir, "stale-unrelated-branch", "main");
      expect(existsSync(expectedDir)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(expectedDir);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
