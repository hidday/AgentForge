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

function spyLogger() {
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

    it("removes and recreates the worktree when the deterministic path already exists", async () => {
      const branchName = "hidday/pry-200-rerun";
      const runId = "11112222-3456-7890-abcd-ef1234567890";
      const logger = spyLogger();
      const svcWithSpy = new GitService(logger);

      // First call creates the worktree at the deterministic path.
      const first = await svcWithSpy.setupRunWorktree(repoPath, runId, "main", branchName);
      expect(existsSync(first.worktreePath)).toBe(true);

      // Leave a marker file (uncommitted) so we can prove the worktree was
      // actually torn down and recreated, not merely reused in place.
      writeFileSync(join(first.worktreePath, "marker-from-first-run.txt"), "leftover");
      expect(existsSync(join(first.worktreePath, "marker-from-first-run.txt"))).toBe(true);

      // Second call with the SAME runId + branchName resolves to the SAME
      // deterministic worktreePath, which now already exists on disk.
      const second = await svcWithSpy.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(existsSync(second.worktreePath)).toBe(true);
      // The leftover marker from the first worktree must be gone: this proves
      // the "path already exists" branch actually removed the old worktree
      // before recreating it, rather than silently reusing stale contents.
      expect(existsSync(join(second.worktreePath, "marker-from-first-run.txt"))).toBe(false);
      expect(await svcWithSpy.currentBranch(second.worktreePath)).toBe(branchName);

      const warnCall = logger.warn.mock.calls.find(
        (c: unknown[]) => c[1] === "Worktree path already exists, removing first",
      );
      expect(warnCall).toBeDefined();

      await svcWithSpy.removeWorktree(repoPath, second.worktreePath);
    });

    it("warns but still succeeds when origin already has the branch (local branch reset to startPoint)", async () => {
      const branchName = "hidday/pry-201-remote-exists";
      const runId = "33334444-3456-7890-abcd-ef1234567890";
      const logger = spyLogger();
      const svcWithSpy = new GitService(logger);

      // Simulate the branch already existing on the remote (e.g. pushed by a
      // previous attempt), with no corresponding local branch or worktree.
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);
      git(["branch", "-D", branchName], repoPath);

      const result = await svcWithSpy.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svcWithSpy.currentBranch(result.worktreePath)).toBe(branchName);

      const warnCall = logger.warn.mock.calls.find(
        (c: unknown[]) =>
          typeof c[1] === "string" &&
          (c[1] as string).includes("origin/<branch> already exists"),
      );
      expect(warnCall).toBeDefined();
      expect(warnCall?.[0]).toMatchObject({ repoPath, branchName });

      await svcWithSpy.removeWorktree(repoPath, result.worktreePath);
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

    it("push() pushes the current branch to origin with -u", async () => {
      git(["checkout", "-b", "feature/push-test"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      git(["add", "."], repoPath);
      git(["commit", "-m", "add pushed.txt"], repoPath);

      await svc.push(repoPath, "feature/push-test");

      const branchesOnOrigin = git(["branch", "--list", "feature/push-test"], bareDir);
      expect(branchesOnOrigin).toContain("feature/push-test");
    });

    it("push() throws GitError when the push fails (e.g. unknown remote branch target)", async () => {
      // No "origin" remote configured on this repo, so pushing must fail.
      const isolatedRepo = createTestRepo();
      try {
        await expect(svc.push(isolatedRepo, "main")).rejects.toThrow(GitError);
      } finally {
        rmSync(isolatedRepo, { recursive: true, force: true });
      }
    });

    it("commitAndPush() asserts the branch, commits all changes, and pushes to origin", async () => {
      git(["checkout", "-b", "feature/commit-and-push"], repoPath);
      writeFileSync(join(repoPath, "new-feature.txt"), "feature content");

      await svc.commitAndPush(repoPath, "feature/commit-and-push", "[AI] add feature");

      expect(await svc.hasChanges(repoPath)).toBe(false);
      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("[AI] add feature");
      const branchesOnOrigin = git(["branch", "--list", "feature/commit-and-push"], bareDir);
      expect(branchesOnOrigin).toContain("feature/commit-and-push");
    });

    it("commitAndPush() throws BranchMismatchError without pushing when on the wrong branch", async () => {
      git(["checkout", "-b", "feature/wrong-branch"], repoPath);

      await expect(
        svc.commitAndPush(repoPath, "feature/some-other-branch", "[AI] should not land"),
      ).rejects.toThrow(BranchMismatchError);

      // Nothing should have reached origin for a branch that was never pushed.
      const branchesOnOrigin = git(["branch", "--list", "feature/some-other-branch"], bareDir);
      expect(branchesOnOrigin).toBe("");
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
