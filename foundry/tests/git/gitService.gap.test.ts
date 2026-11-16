import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  GitService,
  GitError,
  buildWorktreeDirName,
} from "../../src/git/gitService.js";

// This file covers gaps left by tests/git/gitService.test.ts:
// - GitError's `cause instanceof Error ? ... : String(cause)` false branch (direct
//   construction with a non-Error cause)
// - shortenSlug's maxLen break branch (via buildWorktreeDirName)
// - fetch() / createWorktree() / findWorktreeForBranch() / hasChanges() GitError
//   throw paths on real git failures
// - pruneWorktrees() / removeWorktree() best-effort-warn (catch, no throw) paths
// - remoteBranchExists() true path (origin branch actually present)
// - push() success and failure, and commitAndPush() end-to-end
// - commitAll() failure path (exec throws -> GitError)
// - setupRunWorktree(): the "worktree path already exists" branch and the
//   "origin/<branch> already exists" warning branch

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-gap-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("GitService gap coverage", () => {
  describe("GitError", () => {
    it("falls back to String(cause) when cause is not an Error instance", () => {
      const err = new GitError("fetch", "/repo", "a plain string cause");
      expect(err.message).toBe("git fetch failed in /repo: a plain string cause");
      expect(err.name).toBe("GitError");
    });
  });

  describe("buildWorktreeDirName slug length cap", () => {
    it("breaks the slug accumulation once adding the next part would exceed 30 chars", () => {
      const branchName =
        "eng-1-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-dddddddddddddddd";
      const result = buildWorktreeDirName("shortid1", branchName);
      // Only the first 16-char part fits; the second would push length to 33 (>30).
      expect(result).toBe("run-shortid1-eng-1-aaaaaaaaaaaaaaaa");
    });
  });

  describe("real-git failure/warn paths", () => {
    let repoPath: string;
    let svc: GitService;
    let logger: ReturnType<typeof makeMockLogger>;

    beforeEach(() => {
      repoPath = createTestRepo();
      logger = makeMockLogger();
      svc = new GitService(logger);
    });

    afterEach(() => {
      rmSync(repoPath, { recursive: true, force: true });
    });

    it("fetch() throws GitError when origin is not configured", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
      await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed/);
    });

    it("createWorktree() throws GitError when startPoint does not exist", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-wt");
      await expect(
        svc.createWorktree(repoPath, wtPath, "doomed-branch", "nonexistent-start-point"),
      ).rejects.toThrow(GitError);
    });

    it("findWorktreeForBranch() throws GitError when repoPath is not a git repo", async () => {
      await expect(svc.findWorktreeForBranch("/nonexistent-repo-path", "main")).rejects.toThrow(
        GitError,
      );
    });

    it("hasChanges() throws GitError when worktreePath is not a git repo", async () => {
      await expect(svc.hasChanges("/nonexistent-repo-path")).rejects.toThrow(GitError);
    });

    it("commitAll() throws GitError when the underlying git command fails", async () => {
      await expect(svc.commitAll("/nonexistent-repo-path", "msg")).rejects.toThrow(GitError);
    });

    it("pruneWorktrees() swallows the error and logs a warning instead of throwing", async () => {
      await expect(svc.pruneWorktrees("/nonexistent-repo-path")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: "/nonexistent-repo-path" }),
        "Failed to prune worktrees (best-effort cleanup)",
      );
    });

    it("removeWorktree() swallows the error and logs a warning instead of throwing", async () => {
      const bogusPath = join(repoPath, "does-not-exist");
      await expect(svc.removeWorktree(repoPath, bogusPath)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath, worktreePath: bogusPath }),
        "Failed to remove worktree (best-effort cleanup)",
      );
    });

    describe("with a bare origin remote", () => {
      let bareDir: string;

      beforeEach(() => {
        bareDir = mkdtempSync(join(tmpdir(), "gitservice-gap-bare-"));
        git(["clone", "--bare", repoPath, bareDir], tmpdir());
        git(["remote", "add", "origin", bareDir], repoPath);
        git(["fetch", "origin"], repoPath);
      });

      afterEach(() => {
        rmSync(bareDir, { recursive: true, force: true });
      });

      it("remoteBranchExists() returns true when origin/<branch> is actually present", async () => {
        const wtPath = join(repoPath, ".worktrees", "pushed-wt");
        await svc.createWorktree(repoPath, wtPath, "pushed-branch", "main");
        await svc.push(wtPath, "pushed-branch");

        expect(await svc.remoteBranchExists(repoPath, "pushed-branch")).toBe(true);
        await svc.removeWorktree(repoPath, wtPath);
      });

      it("push() pushes the branch to origin and sets up tracking", async () => {
        const wtPath = join(repoPath, ".worktrees", "push-success-wt");
        await svc.createWorktree(repoPath, wtPath, "push-success-branch", "main");
        writeFileSync(join(wtPath, "new.txt"), "hello");
        await svc.commitAll(wtPath, "add new file");

        await expect(svc.push(wtPath, "push-success-branch")).resolves.toBeUndefined();

        const branches = git(["branch", "-r"], repoPath);
        expect(branches).toContain("origin/push-success-branch");

        await svc.removeWorktree(repoPath, wtPath);
      });

      it("push() throws GitError when the push fails (e.g. non-fast-forward)", async () => {
        const wtPath = join(repoPath, ".worktrees", "push-fail-wt");
        await svc.createWorktree(repoPath, wtPath, "push-fail-branch", "main");
        await svc.push(wtPath, "push-fail-branch");

        // Diverge the remote so a second push without pulling is rejected.
        const otherClone = mkdtempSync(join(tmpdir(), "gitservice-gap-other-"));
        git(["clone", bareDir, otherClone], tmpdir());
        git(["checkout", "push-fail-branch"], otherClone);
        writeFileSync(join(otherClone, "other.txt"), "from elsewhere");
        git(["add", "."], otherClone);
        git(["config", "user.email", "test@test.com"], otherClone);
        git(["config", "user.name", "Test"], otherClone);
        git(["commit", "-m", "diverging commit"], otherClone);
        git(["push", "origin", "push-fail-branch"], otherClone);

        writeFileSync(join(wtPath, "local.txt"), "local change");
        await svc.commitAll(wtPath, "local diverging commit");

        await expect(svc.push(wtPath, "push-fail-branch")).rejects.toThrow(GitError);

        rmSync(otherClone, { recursive: true, force: true });
        await svc.removeWorktree(repoPath, wtPath);
      });

      it("commitAndPush() asserts the branch, commits, and pushes in one call", async () => {
        const wtPath = join(repoPath, ".worktrees", "commit-and-push-wt");
        await svc.createWorktree(repoPath, wtPath, "commit-and-push-branch", "main");
        writeFileSync(join(wtPath, "feature.txt"), "feature content");

        await svc.commitAndPush(wtPath, "commit-and-push-branch", "[AI] Implement feature");

        const log = git(["log", "--oneline"], wtPath);
        expect(log).toContain("[AI] Implement feature");
        const branches = git(["branch", "-r"], repoPath);
        expect(branches).toContain("origin/commit-and-push-branch");

        await svc.removeWorktree(repoPath, wtPath);
      });

      it("setupRunWorktree() recreates the worktree when the target directory already exists", async () => {
        const runId = "11112222-3333-4444-5555-666677778888";
        const branchName = "hidday/pry-7-duplicate-setup";

        const first = await svc.setupRunWorktree(repoPath, runId, "main", branchName);
        expect(existsSync(first.worktreePath)).toBe(true);

        // Do NOT clean up: calling setupRunWorktree again with the same runId/branchName
        // computes the same deterministic worktreePath, which still exists on disk.
        const second = await svc.setupRunWorktree(repoPath, runId, "main", branchName);
        expect(second.worktreePath).toBe(first.worktreePath);
        expect(existsSync(second.worktreePath)).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(
          { worktreePath: first.worktreePath },
          "Worktree path already exists, removing first",
        );

        await svc.removeWorktree(repoPath, second.worktreePath);
      });

      it("setupRunWorktree() warns when origin/<branch> already exists", async () => {
        const branchName = "hidday/pry-8-already-on-origin";
        const preexisting = join(repoPath, ".worktrees", "preexisting-push-wt");
        await svc.createWorktree(repoPath, preexisting, branchName, "main");
        await svc.push(preexisting, branchName);
        await svc.removeWorktree(repoPath, preexisting);
        logger.warn.mockClear();

        const runId = "99998888-7777-6666-5555-444433332222";
        const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

        expect(logger.warn).toHaveBeenCalledWith(
          { repoPath, branchName },
          expect.stringContaining("origin/<branch> already exists"),
        );
        expect(existsSync(result.worktreePath)).toBe(true);

        await svc.removeWorktree(repoPath, result.worktreePath);
      });
    });
  });
});
