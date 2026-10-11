import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

// Closes the remaining gaps in gitService.test.ts: the GitError-wrapping catch
// branches of fetch/createWorktree/findWorktreeForBranch/hasChanges/commitAll,
// the best-effort (non-throwing) catch branches of pruneWorktrees/removeWorktree,
// remoteBranchExists' "exists" (true) branch and the associated warning log in
// setupRunWorktree, setupRunWorktree's "worktree path already exists" branch,
// and push()/commitAndPush() (never exercised at all previously: no test had a
// working `origin` remote to push to, nor one without one to fail against).

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-ab-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeLogger() {
  const warnCalls: unknown[][] = [];
  const infoCalls: unknown[][] = [];
  return {
    info: (...args: unknown[]) => infoCalls.push(args),
    warn: (...args: unknown[]) => warnCalls.push(args),
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child() {
      return this;
    },
    warnCalls,
    infoCalls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("buildWorktreeDirName slug-length edge case", () => {
  it("drops the slug entirely when its first word alone already exceeds the 30-char cap", () => {
    // shortenSlug's loop appends "part" to an empty `result`, finds the combined
    // length already over maxLen, and breaks *before* ever assigning `result` --
    // so the slug collapses to "" and only the issue id is appended.
    const hugeFirstWord = "a".repeat(40);
    expect(buildWorktreeDirName("abcdefgh", `hidday/pry-5-${hugeFirstWord}-rest`)).toBe(
      "run-abcdefgh-pry-5",
    );
  });
});

describe("GitService additional branch coverage", () => {
  let repoPath: string;
  let notARepo: string;
  let svc: GitService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    repoPath = createTestRepo();
    notARepo = mkdtempSync(join(tmpdir(), "gitservice-ab-norepo-"));
    logger = makeLogger();
    svc = new GitService(logger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(notARepo, { recursive: true, force: true });
  });

  describe("GitError-wrapping catch branches", () => {
    it("fetch throws GitError when the repo/remote is invalid", async () => {
      await expect(svc.fetch(notARepo)).rejects.toThrow(GitError);
      await expect(svc.fetch(notARepo)).rejects.toThrow(/git fetch failed/);
    });

    it("createWorktree throws GitError when the repo path is invalid", async () => {
      await expect(
        svc.createWorktree(notARepo, join(notARepo, "wt"), "branch", "main"),
      ).rejects.toThrow(GitError);
    });

    it("findWorktreeForBranch throws GitError when the repo path is invalid", async () => {
      await expect(svc.findWorktreeForBranch(notARepo, "main")).rejects.toThrow(GitError);
    });

    it("hasChanges throws GitError when the repo path is invalid", async () => {
      await expect(svc.hasChanges(notARepo)).rejects.toThrow(GitError);
    });

    it("commitAll throws GitError when 'git add' fails (invalid repo path)", async () => {
      await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(GitError);
      await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(/git commit failed/);
    });
  });

  describe("best-effort (non-throwing) catch branches", () => {
    it("pruneWorktrees swallows the error and logs a warning instead of throwing", async () => {
      await expect(svc.pruneWorktrees(notARepo)).resolves.toBeUndefined();
      expect(logger.warnCalls.length).toBe(1);
      expect(logger.warnCalls[0][1]).toBe("Failed to prune worktrees (best-effort cleanup)");
    });

    it("removeWorktree swallows the error and logs a warning instead of throwing", async () => {
      const bogusPath = join(repoPath, ".worktrees", "does-not-exist");
      await expect(svc.removeWorktree(repoPath, bogusPath)).resolves.toBeUndefined();
      expect(logger.warnCalls.length).toBe(1);
      expect(logger.warnCalls[0][1]).toBe("Failed to remove worktree (best-effort cleanup)");
    });
  });

  describe("push and commitAndPush", () => {
    it("push throws GitError when there is no configured origin remote", async () => {
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(/git push failed/);
    });

    it("commitAndPush asserts the branch, commits, and pushes to a real origin remote", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-ab-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);

      writeFileSync(join(repoPath, "feature.txt"), "new content");
      await svc.commitAndPush(repoPath, "main", "Add feature");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("Add feature");
      expect(await svc.hasChanges(repoPath)).toBe(false);

      // Verify the commit actually landed on the bare "remote".
      const remoteLog = git(["log", "--oneline", "main"], bareDir);
      expect(remoteLog).toContain("Add feature");

      rmSync(bareDir, { recursive: true, force: true });
    });

    it("commitAndPush throws BranchMismatchError-free GitError when push fails (no origin)", async () => {
      writeFileSync(join(repoPath, "feature2.txt"), "content");
      await expect(svc.commitAndPush(repoPath, "main", "Add feature 2")).rejects.toThrow(GitError);
      // The commit itself should have succeeded even though the push failed.
      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("Add feature 2");
    });
  });

  describe("setupRunWorktree additional branches", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-ab-setup-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("removes and recreates the worktree directory when the target path already exists", async () => {
      const runId = "11111111-2222-3333-4444-555555555555";
      const branchName = "hidday/pry-7-preexisting-path";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const expectedPath = join(repoPath, ".worktrees", dirName);

      // Pre-create a REAL (registered) worktree at the exact path setupRunWorktree
      // will compute, but checked out on an unrelated branch -- so the "path
      // already exists" branch fires (not the separate "branch already checked
      // out elsewhere" branch), and removeWorktree can actually clean it up.
      await svc.createWorktree(repoPath, expectedPath, "stale-placeholder-branch", "main");
      expect(existsSync(expectedPath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(expectedPath);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        logger.warnCalls.some((c) => c[1] === "Worktree path already exists, removing first"),
      ).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists remotely", async () => {
      const branchName = "hidday/pry-8-already-on-remote";
      // Push the branch to origin ahead of time so remoteBranchExists() is true.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);

      const runId = "66666666-7777-8888-9999-aaaaaaaaaaaa";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        logger.warnCalls.some(
          (c) =>
            c[1] ===
            "origin/<branch> already exists; local branch will be reset to startPoint. " +
              "If the remote has unmerged commits, the final push will fail (non-fast-forward) " +
              "and must be resolved manually.",
        ),
      ).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
