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

// ---------------------------------------------------------------------------
// Extended coverage: failure/best-effort paths for fetch, createWorktree,
// pruneWorktrees, findWorktreeForBranch, removeWorktree, hasChanges,
// commitAll, push, commitAndPush, remoteBranchExists, the setupRunWorktree
// stale-path and origin-branch-exists branches, GitError's non-Error cause,
// and shortenSlug's length-budget break.
// ---------------------------------------------------------------------------

function spyLogger() {
  const warn = [] as unknown[][];
  const info = [] as unknown[][];
  const logger = {
    info: (...args: unknown[]) => {
      info.push(args);
    },
    warn: (...args: unknown[]) => {
      warn.push(args);
    },
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => logger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { logger, warn, info };
}

describe("GitService - extended coverage", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe("GitError", () => {
    it("stringifies a non-Error cause instead of reading .message", () => {
      const err = new GitError("fetch", "/tmp/repo", "boom");
      expect(err.message).toBe("git fetch failed in /tmp/repo: boom");
      expect(err.name).toBe("GitError");
    });
  });

  describe("fetch", () => {
    it("throws GitError when the repo has no origin remote", async () => {
      const svc = new GitService(spyLogger().logger);
      await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
      await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed/);
    });
  });

  describe("createWorktree failure", () => {
    it("throws GitError when the start point does not exist", async () => {
      const svc = new GitService(spyLogger().logger);
      const wtPath = join(repoPath, ".worktrees", "bad-wt");
      await expect(
        svc.createWorktree(repoPath, wtPath, "some-branch", "does-not-exist-startpoint"),
      ).rejects.toThrow(GitError);
      expect(existsSync(wtPath)).toBe(false);
    });
  });

  describe("pruneWorktrees failure (best-effort)", () => {
    it("swallows the failure and logs a warning instead of throwing", async () => {
      const { logger, warn } = spyLogger();
      const svc = new GitService(logger);
      await expect(svc.pruneWorktrees("/definitely/does/not/exist")).resolves.toBeUndefined();
      expect(warn).toHaveLength(1);
      expect(warn[0]?.[1]).toBe("Failed to prune worktrees (best-effort cleanup)");
      const meta = warn[0]?.[0] as { repoPath: string; error: string };
      expect(meta.repoPath).toBe("/definitely/does/not/exist");
      expect(typeof meta.error).toBe("string");
      expect(meta.error.length).toBeGreaterThan(0);
    });
  });

  describe("findWorktreeForBranch failure", () => {
    it("throws GitError for a non-git directory", async () => {
      const svc = new GitService(spyLogger().logger);
      await expect(
        svc.findWorktreeForBranch("/definitely/does/not/exist", "main"),
      ).rejects.toThrow(GitError);
    });
  });

  describe("removeWorktree failure (best-effort)", () => {
    it("swallows the failure and logs a warning instead of throwing", async () => {
      const { logger, warn } = spyLogger();
      const svc = new GitService(logger);
      const bogusPath = join(repoPath, ".worktrees", "never-existed");
      await expect(svc.removeWorktree(repoPath, bogusPath)).resolves.toBeUndefined();
      expect(warn).toHaveLength(1);
      expect(warn[0]?.[1]).toBe("Failed to remove worktree (best-effort cleanup)");
      const meta = warn[0]?.[0] as { repoPath: string; worktreePath: string; error: string };
      expect(meta.worktreePath).toBe(bogusPath);
      expect(typeof meta.error).toBe("string");
    });
  });

  describe("hasChanges failure", () => {
    it("throws GitError for a non-git directory", async () => {
      const svc = new GitService(spyLogger().logger);
      await expect(svc.hasChanges("/definitely/does/not/exist")).rejects.toThrow(GitError);
    });
  });

  describe("commitAll failure", () => {
    it("throws GitError when the underlying git command fails", async () => {
      const svc = new GitService(spyLogger().logger);
      await expect(
        svc.commitAll("/definitely/does/not/exist", "msg"),
      ).rejects.toThrow(GitError);
    });
  });

  describe("push", () => {
    it("throws GitError when no origin remote is configured", async () => {
      const svc = new GitService(spyLogger().logger);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
      await expect(svc.push(repoPath, "main")).rejects.toThrow(/git push failed/);
    });

    it("pushes the branch to origin and updates the remote ref", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
      try {
        git(["clone", "--bare", repoPath, bareDir], tmpdir());
        git(["remote", "add", "origin", bareDir], repoPath);

        const svc = new GitService(spyLogger().logger);
        await expect(svc.push(repoPath, "main")).resolves.toBeUndefined();

        const remoteRefs = execFileSync("git", ["ls-remote", bareDir, "refs/heads/main"], {
          encoding: "utf-8",
        });
        expect(remoteRefs).toContain("refs/heads/main");
        const localHead = git(["rev-parse", "HEAD"], repoPath);
        expect(remoteRefs).toContain(localHead);
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
      }
    });
  });

  describe("commitAndPush", () => {
    it("commits the dirty tree and pushes it to origin when on the correct branch", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-candp-bare-"));
      try {
        git(["clone", "--bare", repoPath, bareDir], tmpdir());
        git(["remote", "add", "origin", bareDir], repoPath);
        writeFileSync(join(repoPath, "new.txt"), "hello world");

        const svc = new GitService(spyLogger().logger);
        await svc.commitAndPush(repoPath, "main", "extended coverage commit");

        const log = git(["log", "--oneline", "-1"], repoPath);
        expect(log).toContain("extended coverage commit");
        expect(await svc.hasChanges(repoPath)).toBe(false);

        const remoteLog = execFileSync(
          "git",
          ["--git-dir", bareDir, "log", "main", "-1", "--oneline"],
          { encoding: "utf-8" },
        );
        expect(remoteLog).toContain("extended coverage commit");
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
      }
    });

    it("rejects with BranchMismatchError and never attempts to push when on the wrong branch", async () => {
      git(["checkout", "-b", "not-main"], repoPath);
      const svc = new GitService(spyLogger().logger);
      await expect(svc.commitAndPush(repoPath, "main", "msg")).rejects.toThrow(
        BranchMismatchError,
      );
    });
  });

  describe("remoteBranchExists", () => {
    it("returns true when origin/<branch> exists", async () => {
      const bareDir = mkdtempSync(join(tmpdir(), "gitservice-rbe-bare-"));
      try {
        git(["clone", "--bare", repoPath, bareDir], tmpdir());
        git(["remote", "add", "origin", bareDir], repoPath);
        git(["fetch", "origin"], repoPath);

        const svc = new GitService(spyLogger().logger);
        expect(await svc.remoteBranchExists(repoPath, "main")).toBe(true);
        expect(await svc.remoteBranchExists(repoPath, "no-such-branch")).toBe(false);
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
      }
    });
  });

  describe("setupRunWorktree (additional branches)", () => {
    let bareDir: string;

    beforeEach(() => {
      bareDir = mkdtempSync(join(tmpdir(), "gitservice-ext-bare-"));
      git(["clone", "--bare", repoPath, bareDir], tmpdir());
      git(["remote", "add", "origin", bareDir], repoPath);
      git(["fetch", "origin"], repoPath);
    });

    afterEach(() => {
      rmSync(bareDir, { recursive: true, force: true });
    });

    it("warns and proceeds when origin already has the target branch", async () => {
      const { logger, warn } = spyLogger();
      const svc = new GitService(logger);
      const branchName = "hidday/pry-200-already-on-origin";

      // Push the branch to origin first so remoteBranchExists() returns true.
      git(["push", "origin", `HEAD:refs/heads/${branchName}`], repoPath);

      const runId = "01234567-3456-7890-abcd-ef1234567890";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        warn.some(
          (call) =>
            typeof call[1] === "string" &&
            (call[1] as string).includes("origin/<branch> already exists"),
        ),
      ).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });

    it("removes a stale worktree occupying the deterministic path before recreating it", async () => {
      const { logger, warn } = spyLogger();
      const svc = new GitService(logger);
      const runId = "cafebabe-3456-7890-abcd-ef1234567890";
      const branchName = "hidday/pry-201-stale-path";
      const shortId = runId.slice(0, 8);
      const dirName = buildWorktreeDirName(shortId, branchName);
      const expectedPath = join(repoPath, ".worktrees", dirName);

      // Pre-occupy the deterministic path with a real worktree on a different branch.
      await svc.createWorktree(repoPath, expectedPath, "placeholder-branch", "main");
      expect(existsSync(expectedPath)).toBe(true);

      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(result.worktreePath).toBe(expectedPath);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(
        warn.some(
          (call) =>
            typeof call[1] === "string" &&
            (call[1] as string).includes("Worktree path already exists, removing first"),
        ),
      ).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });

  describe("shortenSlug (via buildWorktreeDirName)", () => {
    it("stops appending parts once the length budget (30 chars) would be exceeded", () => {
      const longPart = "x".repeat(30);
      const branchName = `eng-1-short-${longPart}`;
      expect(buildWorktreeDirName("abcdefgh", branchName)).toBe("run-abcdefgh-eng-1-short");
    });
  });
});
