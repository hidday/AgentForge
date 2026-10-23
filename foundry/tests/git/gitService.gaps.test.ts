import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

// Covers GitService branches not exercised by gitService.test.ts: the error
// (GitError-throwing) paths of fetch/createWorktree/findWorktreeForBranch/
// hasChanges/commitAll, the best-effort (warn, no throw) catch paths of
// pruneWorktrees/removeWorktree, the remoteBranchExists() success path, the
// push()/commitAndPush() methods (never directly called by the existing
// suite), and the setupRunWorktree() branches where the worktree path or the
// remote branch already exists.

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-gaps-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function noopLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: () => noopLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("GitError — non-Error cause", () => {
  it("stringifies a non-Error cause in the constructed message", () => {
    const err = new GitError("fetch", "/repo", "plain string cause");
    expect(err.message).toBe("git fetch failed in /repo: plain string cause");
    expect(err.name).toBe("GitError");
  });
});

describe("buildWorktreeDirName — shortenSlug's maxLen break branch", () => {
  it("stops accumulating slug words (keeping only the prior ones) once the next word would exceed maxLen", () => {
    // "shortword" (9 chars) fits; appending "-" + 28 more chars would make the
    // running slug 38 chars, over the 30-char cap, so shortenSlug should stop
    // and keep only "shortword".
    const longSecondWord = "y".repeat(28);
    const dirName = buildWorktreeDirName("abcdefgh", `eng-42-shortword-${longSecondWord}-tail`);
    expect(dirName).toBe("run-abcdefgh-eng-42-shortword");
  });

  it("falls back to omitting the slug entirely when even the first word alone exceeds maxLen", () => {
    const hugeFirstWord = "z".repeat(40);
    const dirName = buildWorktreeDirName("abcdefgh", `eng-42-${hugeFirstWord}`);
    expect(dirName).toBe("run-abcdefgh-eng-42");
  });
});

describe("GitService — error and best-effort branches", () => {
  let repoPath: string;
  let svc: GitService;
  let logger: ReturnType<typeof noopLogger>;

  beforeEach(() => {
    repoPath = createTestRepo();
    logger = noopLogger();
    svc = new GitService(logger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("fetch() throws GitError when the repo has no 'origin' remote", async () => {
    await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    await expect(svc.fetch(repoPath)).rejects.toThrow(/fetch failed/);
  });

  it("createWorktree() throws GitError when the startPoint ref does not exist", async () => {
    const wtPath = join(repoPath, ".worktrees", "bad-wt");
    await expect(
      svc.createWorktree(repoPath, wtPath, "new-branch", "refs/heads/does-not-exist"),
    ).rejects.toThrow(GitError);
    expect(existsSync(wtPath)).toBe(false);
  });

  it("pruneWorktrees() logs a warning and does not throw when the repo path is not a git repository", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "gitservice-gaps-notrepo-"));
    try {
      await expect(svc.pruneWorktrees(notARepo)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: notARepo, error: expect.any(String) }),
        "Failed to prune worktrees (best-effort cleanup)",
      );
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("findWorktreeForBranch() throws GitError when the repo path is not a git repository", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "gitservice-gaps-notrepo2-"));
    try {
      await expect(svc.findWorktreeForBranch(notARepo, "main")).rejects.toThrow(GitError);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("removeWorktree() logs a warning and does not throw when the path is not a registered worktree", async () => {
    await expect(
      svc.removeWorktree(repoPath, join(repoPath, ".worktrees", "never-existed")),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath, error: expect.any(String) }),
      "Failed to remove worktree (best-effort cleanup)",
    );
  });

  it("hasChanges() throws GitError for an invalid repo path", async () => {
    await expect(svc.hasChanges("/nonexistent-path-xyz")).rejects.toThrow(GitError);
  });

  it("commitAll() throws GitError when `git add` fails (invalid repo path)", async () => {
    await expect(svc.commitAll("/nonexistent-path-xyz", "msg")).rejects.toThrow(GitError);
  });

  describe("remoteBranchExists() / push() / commitAndPush() against a real remote", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-gaps-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("remoteBranchExists() returns true once origin/<branch> is fetched", async () => {
      expect(await svc.remoteBranchExists(repoPath, "main")).toBe(true);
      expect(await svc.remoteBranchExists(repoPath, "no-such-branch")).toBe(false);
    });

    it("push() pushes the current branch to origin successfully", async () => {
      git(["checkout", "-b", "feature/push-test"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      git(["add", "."], repoPath);
      git(["commit", "-m", "pushable commit"], repoPath);

      await expect(svc.push(repoPath, "feature/push-test")).resolves.toBeUndefined();

      const branchesOnRemote = git(["branch", "-a"], bareDir);
      expect(branchesOnRemote).toContain("feature/push-test");
    });

    it("push() throws GitError when there is nothing configured to push to", async () => {
      git(["remote", "remove", "origin"], repoPath);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(/push failed/);
    });

    it("commitAndPush() asserts the branch, commits all changes, and pushes in one call", async () => {
      git(["checkout", "-b", "feature/combo-test"], repoPath);
      writeFileSync(join(repoPath, "combo.txt"), "hello");

      await svc.commitAndPush(repoPath, "feature/combo-test", "combo commit");

      expect(await svc.hasChanges(repoPath)).toBe(false);
      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("combo commit");
      const branchesOnRemote = git(["branch", "-a"], bareDir);
      expect(branchesOnRemote).toContain("feature/combo-test");
    });

    it("commitAndPush() rejects with BranchMismatchError before touching the working tree if on the wrong branch", async () => {
      // Stay on "main" but ask to commit/push as if we were on a different branch.
      await expect(
        svc.commitAndPush(repoPath, "feature/not-checked-out", "msg"),
      ).rejects.toThrow(/Branch safety check failed/);
    });
  });

  describe("setupRunWorktree() — pre-existing worktree path and existing remote branch", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-gaps-bare2-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("removes and recreates the worktree directory when the target path already exists on disk", async () => {
      const runId = "11112222-3333-4444-5555-666677778888";
      const branchName = "hidday/pry-1-existing-path";
      const dirName = `run-${runId.slice(0, 8)}-pry-1-existing-path`;
      const worktreePath = join(repoPath, ".worktrees", dirName);

      // Pre-create a stale, unrelated worktree at the exact target path.
      await svc.createWorktree(repoPath, worktreePath, "some-other-branch", "main");
      expect(existsSync(worktreePath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(worktreePath);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(logger.warn).toHaveBeenCalledWith(
        { worktreePath },
        "Worktree path already exists, removing first",
      );

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns (but still succeeds) when origin/<branchName> already exists", async () => {
      const branchName = "hidday/pry-2-remote-exists";
      // Push the branch to origin first so origin/<branchName> exists before setup.
      git(["checkout", "-b", branchName], repoPath);
      git(["push", "-u", "origin", branchName], repoPath);
      git(["checkout", "main"], repoPath);

      const runId = "99998888-3333-4444-5555-666677778888";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.branchName).toBe(branchName);
      expect(existsSync(result.worktreePath)).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        { repoPath, branchName },
        expect.stringContaining("origin/<branch> already exists"),
      );

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
