import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
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

    it("removes a pre-existing empty directory at the computed worktree path before creating it", async () => {
      const runId = "fadedcaf-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-200-preexisting-dir";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const precomputedPath = join(repoPath, ".worktrees", dirName);

      // Simulate a leftover plain directory (not a registered git worktree)
      // sitting at the exact path setupRunWorktree will compute.
      mkdirSync(precomputedPath, { recursive: true });
      expect(existsSync(precomputedPath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(precomputedPath);
      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("warns and still succeeds when origin/<branch> already exists on the remote", async () => {
      // Push the branch to origin first so remoteBranchExists() is true,
      // then verify setupRunWorktree still resets the local branch cleanly
      // off origin/main and logs the non-fast-forward warning.
      const branchName = "hidday/pry-300-already-pushed";
      git(["branch", branchName, "main"], repoPath);
      git(["push", "origin", branchName], repoPath);

      const warnedMessages: unknown[][] = [];
      const warningLogger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnedMessages.push(args),
      } as never;
      const svcWithSpy = new GitService(warningLogger);

      const runId = "beadedfa-3456-7890-abcd-ef1234567890";
      const result = await svcWithSpy.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        warnedMessages.some(
          ([, msg]) => typeof msg === "string" && msg.includes("origin/<branch> already exists"),
        ),
      ).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("findWorktreeForBranch", () => {
    it("returns null when no worktree has the branch", async () => {
      expect(await svc.findWorktreeForBranch(repoPath, "nope")).toBeNull();
    });

    it("throws GitError when the underlying 'worktree list' command fails", async () => {
      await expect(
        svc.findWorktreeForBranch("/nonexistent-repo-path", "nope"),
      ).rejects.toThrow(GitError);
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

    it("drops the slug entirely when its first word alone exceeds the 30-char length cap", () => {
      // shortenSlug's length guard breaks out on the very first word before
      // `result` is ever assigned, so the slug collapses to "" and only the
      // base + issue id remain (boundary: single-word overflow, not the
      // maxParts=4 bound exercised by the other buildWorktreeDirName cases).
      const longWord = "a".repeat(35);
      expect(buildWorktreeDirName("abcdefgh", `eng-99-${longWord}`)).toBe(
        "run-abcdefgh-eng-99",
      );
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

    it("GitError stringifies a non-Error cause via String() rather than reading .message", () => {
      // GitError's cause argument is `unknown`; when a caller passes
      // something other than an Error (e.g. a plain string or object
      // rejection), the constructor must fall back to String(cause) instead
      // of crashing on `.message`.
      const err = new GitError("fetch", "/repo", "a raw string failure");
      expect(err.message).toBe("git fetch failed in /repo: a raw string failure");
      expect(err.name).toBe("GitError");

      const errFromNumber = new GitError("push", "/repo", 42);
      expect(errFromNumber.message).toBe("git push failed in /repo: 42");
    });

    it("hasChanges() throws GitError when the underlying git command fails", async () => {
      await expect(svc.hasChanges("/nonexistent-worktree-path")).rejects.toThrow(GitError);
    });

    it("fetch() throws GitError when the underlying git command fails", async () => {
      await expect(svc.fetch("/nonexistent-repo-path")).rejects.toThrow(GitError);
    });

    it("createWorktree() throws GitError when the underlying git command fails", async () => {
      // startPoint references a ref that doesn't exist, so `git worktree add` fails.
      await expect(
        svc.createWorktree(
          repoPath,
          join(repoPath, ".worktrees", "bad-wt"),
          "bad-branch",
          "refs/heads/does-not-exist",
        ),
      ).rejects.toThrow(GitError);
    });

    it("pruneWorktrees() swallows the error and logs a warning instead of throwing", async () => {
      const warnedMessages: unknown[][] = [];
      const warningLogger = {
        ...noopLogger,
        warn: (...args: unknown[]) => warnedMessages.push(args),
      } as never;
      const svcWithSpy = new GitService(warningLogger);

      await expect(
        svcWithSpy.pruneWorktrees("/nonexistent-repo-path"),
      ).resolves.toBeUndefined();

      expect(
        warnedMessages.some(
          ([, msg]) =>
            typeof msg === "string" && msg.includes("Failed to prune worktrees"),
        ),
      ).toBe(true);
    });

    it("commitAll() throws GitError when the commit itself fails (e.g. a rejecting pre-commit hook)", async () => {
      writeFileSync(join(repoPath, "needs-commit.txt"), "content");
      // A failing pre-commit hook lets `git add -A` and the dirty check both
      // succeed while `git commit` itself fails, exercising commitAll's own
      // catch/GitError branch distinct from the "no changes" early return.
      const hookPath = join(repoPath, ".git", "hooks", "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

      await expect(svc.commitAll(repoPath, "should fail")).rejects.toThrow(GitError);
    });
  });

  describe("push / commitAndPush", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("push() pushes the branch to origin with upstream tracking", async () => {
      git(["checkout", "-b", "feature/push-me"], repoPath);
      writeFileSync(join(repoPath, "pushed.txt"), "content");
      await svc.commitAll(repoPath, "add pushed file");

      await svc.push(repoPath, "feature/push-me");

      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("feature/push-me");
    });

    it("push() throws GitError when the branch does not exist locally", async () => {
      await expect(svc.push(repoPath, "no-such-branch")).rejects.toThrow(GitError);
    });

    it("commitAndPush() asserts the branch, commits, and pushes in one call", async () => {
      git(["checkout", "-b", "feature/combo"], repoPath);
      writeFileSync(join(repoPath, "combo.txt"), "combo content");

      await svc.commitAndPush(repoPath, "feature/combo", "combo commit");

      const log = git(["log", "--oneline"], repoPath);
      expect(log).toContain("combo commit");
      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).toContain("feature/combo");
    });

    it("commitAndPush() throws BranchMismatchError and never pushes when HEAD is on the wrong branch", async () => {
      git(["checkout", "-b", "feature/wrong"], repoPath);
      writeFileSync(join(repoPath, "wrong.txt"), "x");

      await expect(
        svc.commitAndPush(repoPath, "feature/expected", "should not land"),
      ).rejects.toThrow(BranchMismatchError);

      // Nothing should have been committed or pushed since assertBranch runs first.
      expect(await svc.hasChanges(repoPath)).toBe(true);
      const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
      expect(remoteBranches).not.toContain("feature/expected");
    });
  });
});
