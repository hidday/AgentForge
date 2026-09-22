import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  GitService,
  BranchMismatchError,
  GitError,
  buildWorktreeDirName,
} from "../../src/git/gitService.js";

// This file extends tests/git/gitService.test.ts, covering the error-handling
// and less-common branches that the happy-path suite doesn't exercise:
// git command failures (GitError paths), best-effort cleanup warnings,
// push()/commitAndPush() (untested previously), and the setupRunWorktree
// branches for a pre-existing worktree directory and an already-published
// origin branch. Same real-repo-fixture convention as the main suite.

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-err-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeSpyLogger() {
  const spyLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: () => spyLogger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return spyLogger;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected promise to reject, but it resolved");
}

describe("GitError", () => {
  it("uses the cause's own message when the cause is an Error", () => {
    const err = new GitError("push", "/tmp/repo", new Error("non-fast-forward"));
    expect(err.name).toBe("GitError");
    expect(err.message).toBe("git push failed in /tmp/repo: non-fast-forward");
  });

  it("stringifies the cause when it is not an Error instance", () => {
    const err = new GitError("fetch", "/tmp/repo", "some string cause");
    expect(err.message).toBe("git fetch failed in /tmp/repo: some string cause");
  });
});

describe("buildWorktreeDirName boundary conditions", () => {
  it("stops adding slug parts once appending the next one would exceed the max length", () => {
    const longPart = "x".repeat(40);
    const branchName = `pry-42-ab-${longPart}`;
    // "ab" fits within the 30-char slug budget, but "ab-" + 40 x's does not,
    // so shortenSlug must break out of the loop and keep only "ab".
    expect(buildWorktreeDirName("sid12345", branchName)).toBe("run-sid12345-pry-42-ab");
  });
});

describe("GitService error paths", () => {
  let repoPath: string;
  let svc: GitService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let logger: any;

  beforeEach(() => {
    repoPath = createTestRepo();
    logger = makeSpyLogger();
    svc = new GitService(logger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe("fetch", () => {
    it("throws GitError when there is no origin remote configured", async () => {
      const err = await captureRejection(svc.fetch(repoPath));
      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/^git fetch failed in /);
      expect((err as Error).message).toContain(repoPath);
    });
  });

  describe("createWorktree", () => {
    it("throws GitError when the branch already exists and resetIfExists is not set", async () => {
      git(["branch", "dup-branch", "main"], repoPath);
      const wtPath = join(repoPath, ".worktrees", "dup-wt");

      const err = await captureRejection(
        svc.createWorktree(repoPath, wtPath, "dup-branch", "main"),
      );

      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/^git worktree add failed in /);
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("pruneWorktrees", () => {
    it("swallows failures and logs a warning instead of throwing", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.pruneWorktrees(notARepo)).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            repoPath: notARepo,
            error: expect.any(String),
          }),
          "Failed to prune worktrees (best-effort cleanup)",
        );
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  });

  describe("findWorktreeForBranch", () => {
    it("throws GitError for a non-existent repo path", async () => {
      const err = await captureRejection(
        svc.findWorktreeForBranch("/nonexistent-repo-xyz-123", "some-branch"),
      );
      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/^git worktree list failed in /);
    });
  });

  describe("removeWorktree", () => {
    it("swallows failures and logs a warning instead of throwing", async () => {
      const missingPath = join(repoPath, ".worktrees", "never-created");

      await expect(svc.removeWorktree(repoPath, missingPath)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath,
          worktreePath: missingPath,
          error: expect.any(String),
        }),
        "Failed to remove worktree (best-effort cleanup)",
      );
    });
  });

  describe("hasChanges", () => {
    it("throws GitError for a non-existent path", async () => {
      const err = await captureRejection(svc.hasChanges("/nonexistent-dir-xyz-123"));
      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/^git status failed in /);
    });
  });

  describe("commitAll", () => {
    it("throws GitError when the working directory is not a git repo", async () => {
      const err = await captureRejection(svc.commitAll("/nonexistent-dir-xyz-123", "msg"));
      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/^git commit failed in /);
    });
  });

  describe("push (failure)", () => {
    it("throws GitError when the working directory is not a git repo", async () => {
      const err = await captureRejection(svc.push("/nonexistent-dir-xyz-123", "some-branch"));
      expect(err).toBeInstanceOf(GitError);
      expect((err as Error).message).toMatch(/^git push failed in /);
    });
  });

  describe("remoteBranchExists", () => {
    it("returns true when origin/<branch> exists", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-err-bare-"));
      try {
        git(["clone", "--bare", repoPath, bareDir], tmpdir());
        git(["remote", "add", "origin", bareDir], repoPath);
        // Publish a branch on "origin" directly, without a matching local branch.
        git(["push", "origin", "main:published-branch"], repoPath);
        await svc.fetch(repoPath);

        expect(await svc.remoteBranchExists(repoPath, "published-branch")).toBe(true);
        expect(await svc.remoteBranchExists(repoPath, "never-published")).toBe(false);
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
      }
    });
  });

  describe("with an origin remote (push / commitAndPush / setupRunWorktree)", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-err-bare2-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    describe("push", () => {
      it("pushes the branch to origin and sets up tracking", async () => {
        const wtPath = join(repoPath, ".worktrees", "push-wt");
        await svc.createWorktree(repoPath, wtPath, "push-branch", "main");

        await expect(svc.push(wtPath, "push-branch")).resolves.toBeUndefined();

        const remoteHeads = git(["ls-remote", "--heads", bareDir, "push-branch"], tmpdir());
        expect(remoteHeads).toContain("refs/heads/push-branch");

        await svc.removeWorktree(repoPath, wtPath);
      });
    });

    describe("commitAndPush", () => {
      it("commits and pushes in one call", async () => {
        const wtPath = join(repoPath, ".worktrees", "candp-wt");
        await svc.createWorktree(repoPath, wtPath, "candp-branch", "main");
        writeFileSync(join(wtPath, "new.txt"), "hello from commitAndPush");

        await svc.commitAndPush(wtPath, "candp-branch", "combined commit");

        const log = git(["log", "--oneline"], wtPath);
        expect(log).toContain("combined commit");
        expect(await svc.hasChanges(wtPath)).toBe(false);

        const remoteLog = git(["log", "--oneline", "candp-branch"], bareDir);
        expect(remoteLog).toContain("combined commit");

        await svc.removeWorktree(repoPath, wtPath);
      });

      it("rejects with BranchMismatchError and does not commit when HEAD differs", async () => {
        writeFileSync(join(repoPath, "dirty.txt"), "uncommitted change");
        expect(await svc.hasChanges(repoPath)).toBe(true);

        const err = await captureRejection(
          svc.commitAndPush(repoPath, "some-other-branch", "should not happen"),
        );
        expect(err).toBeInstanceOf(BranchMismatchError);

        // The mismatch must be caught before commitAll/push run: the working
        // tree is still dirty and no new commit was created.
        expect(await svc.hasChanges(repoPath)).toBe(true);
        const log = git(["log", "--oneline"], repoPath);
        expect(log).not.toContain("should not happen");
      });
    });

    describe("setupRunWorktree", () => {
      it("removes a pre-existing worktree directory before recreating it (idempotent retry)", async () => {
        const runId = "11112222-3456-7890-abcd-ef1234567890";
        const branchName = "hidday/pry-200-retry";

        const first = await svc.setupRunWorktree(repoPath, runId, "main", branchName);
        expect(existsSync(first.worktreePath)).toBe(true);

        // Simulate a retry of the same run without cleaning up first (e.g. a
        // crash after worktree creation but before the run completed).
        const second = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

        expect(second.worktreePath).toBe(first.worktreePath);
        expect(existsSync(second.worktreePath)).toBe(true);
        expect(await svc.currentBranch(second.worktreePath)).toBe(branchName);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ worktreePath: first.worktreePath }),
          "Worktree path already exists, removing first",
        );

        await svc.removeWorktree(repoPath, second.worktreePath);
      });

      it("logs a warning and proceeds when origin/<branch> already exists", async () => {
        const branchName = "hidday/pry-300-exists-on-origin";
        // Publish the branch on origin directly, before any local worktree exists.
        git(["push", "origin", `main:${branchName}`], repoPath);

        const runId = "22223333-3456-7890-abcd-ef1234567890";
        const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

        expect(existsSync(result.worktreePath)).toBe(true);
        expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ repoPath, branchName }),
          expect.stringContaining("origin/<branch> already exists"),
        );

        await svc.removeWorktree(repoPath, result.worktreePath);
      });
    });
  });
});
