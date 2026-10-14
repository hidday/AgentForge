import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  describe("fetch", () => {
    it("wraps a git failure as a GitError when there is no origin remote", async () => {
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    });
  });

  describe("createWorktree failure handling", () => {
    it("wraps a git failure as a GitError when the start point doesn't exist", async () => {
      const wtPath = join(repoPath, ".worktrees", "bad-start-point");
      await expect(
        svc.createWorktree(repoPath, wtPath, "doomed-branch", "no-such-ref"),
      ).rejects.toThrow(GitError);
    });
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

    it("wraps a git failure as a GitError", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.hasChanges(notARepo)).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
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

    it("wraps a git failure as a GitError when the directory isn't a git repo", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.commitAll(notARepo, "msg")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  });

  describe("removeWorktree failure handling", () => {
    it("does not throw when the worktree remove command fails (best-effort cleanup)", async () => {
      // No worktree was ever created at this path, so `git worktree remove` fails.
      await expect(
        svc.removeWorktree(repoPath, join(repoPath, ".worktrees", "never-existed")),
      ).resolves.toBeUndefined();
    });
  });

  describe("pruneWorktrees failure handling", () => {
    it("does not throw when the prune command fails (best-effort cleanup)", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.pruneWorktrees(notARepo)).resolves.toBeUndefined();
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
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

    it("push pushes the current branch to origin with upstream tracking", async () => {
      git(["checkout", "-b", "feature-push"], repoPath);
      writeFileSync(join(repoPath, "new-file.txt"), "content\n");
      await svc.commitAll(repoPath, "add new-file");

      await svc.push(repoPath, "feature-push");

      const branchesOnBare = git(["branch", "--list", "feature-push"], bareDir);
      expect(branchesOnBare).toContain("feature-push");
    });

    it("push wraps a git failure as a GitError", async () => {
      // No such branch exists locally, so pushing it must fail.
      await expect(svc.push(repoPath, "no-such-branch")).rejects.toThrow(GitError);
    });

    it("commitAndPush asserts the branch, commits, and pushes in one call", async () => {
      git(["checkout", "-b", "feature-combo"], repoPath);
      writeFileSync(join(repoPath, "combo.txt"), "content\n");

      await svc.commitAndPush(repoPath, "feature-combo", "combo commit");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("combo commit");
      const branchesOnBare = git(["branch", "--list", "feature-combo"], bareDir);
      expect(branchesOnBare).toContain("feature-combo");
    });

    it("commitAndPush throws BranchMismatchError without pushing when on the wrong branch", async () => {
      await expect(svc.commitAndPush(repoPath, "not-the-current-branch", "msg")).rejects.toThrow(
        BranchMismatchError,
      );

      const branchesOnBare = git(["branch", "--list", "not-the-current-branch"], bareDir);
      expect(branchesOnBare).toBe("");
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

    it("removes a stale worktree directory already present at the computed path before recreating it", async () => {
      const warn = () => {};
      const spyLogger = { ...noopLogger, warn: () => warn() };
      const spySvc = new GitService(spyLogger);

      const runId = "11111111-2222-3333-4444-555555555555";
      const branchName = "hidday/pry-7-recreate-worktree";

      const first = await spySvc.setupRunWorktree(repoPath, runId, "main", branchName);
      expect(existsSync(first.worktreePath)).toBe(true);

      // Call again with the same runId+branchName, WITHOUT removing the first
      // worktree first — the computed worktreePath already exists on disk,
      // exercising the "remove stale worktree at this exact path" branch.
      const second = await spySvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(existsSync(second.worktreePath)).toBe(true);
      expect(await spySvc.currentBranch(second.worktreePath)).toBe(branchName);

      await spySvc.removeWorktree(repoPath, second.worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists from a prior push", async () => {
      const warnCalls: unknown[][] = [];
      const spyLogger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnCalls.push(args),
      };
      const spySvc = new GitService(spyLogger);

      const branchName = "hidday/pry-8-already-on-origin";
      // Simulate a prior run that pushed this branch to origin, then had its
      // local branch/worktree cleaned up (so only the remote ref remains).
      await spySvc.createWorktree(repoPath, join(repoPath, ".worktrees", "tmp-push"), branchName, "main");
      git(["push", "origin", branchName], repoPath);
      await spySvc.removeWorktree(repoPath, join(repoPath, ".worktrees", "tmp-push"));
      git(["branch", "-D", branchName], repoPath);

      const runId = "66666666-7777-8888-9999-000000000000";
      const result = await spySvc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await spySvc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        warnCalls.some((call) => String(call[1] ?? "").includes("already exists")),
      ).toBe(true);

      await spySvc.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("findWorktreeForBranch", () => {
    it("returns null when no worktree has the branch", async () => {
      expect(await svc.findWorktreeForBranch(repoPath, "nope")).toBeNull();
    });

    it("wraps a git failure as a GitError when the directory isn't a git repo", async () => {
      const notARepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
      try {
        await expect(svc.findWorktreeForBranch(notARepo, "nope")).rejects.toThrow(GitError);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
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
