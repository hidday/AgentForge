import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-push-test-"));
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

describe("GitService.push", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-push-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    svc = new GitService(noopLogger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("pushes the current branch to origin with upstream tracking", async () => {
    git(["checkout", "-b", "feature/push-me"], repoPath);
    writeFileSync(join(repoPath, "new.txt"), "content");
    git(["add", "."], repoPath);
    git(["commit", "-m", "add file"], repoPath);

    await svc.push(repoPath, "feature/push-me");

    const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
    expect(remoteBranches).toContain("refs/heads/feature/push-me");
  });

  it("throws a GitError when the push fails (e.g. remote does not exist)", async () => {
    git(["remote", "remove", "origin"], repoPath);

    await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
  });
});

describe("GitService.commitAndPush", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-commitpush-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    svc = new GitService(noopLogger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("asserts the branch, commits pending changes, and pushes in sequence", async () => {
    writeFileSync(join(repoPath, "change.txt"), "hello");

    await svc.commitAndPush(repoPath, "main", "commit via commitAndPush");

    const log = git(["log", "--oneline"], repoPath);
    expect(log).toContain("commit via commitAndPush");
    expect(await svc.hasChanges(repoPath)).toBe(false);

    const remoteBranches = git(["ls-remote", "--heads", bareDir], tmpdir());
    expect(remoteBranches).toContain("refs/heads/main");
  });

  it("rejects with BranchMismatchError-derived failure before committing when on the wrong branch", async () => {
    git(["checkout", "-b", "other-branch"], repoPath);
    writeFileSync(join(repoPath, "change.txt"), "hello");

    await expect(svc.commitAndPush(repoPath, "main", "should not commit")).rejects.toThrow();

    // The commit must not have happened since assertBranch failed first.
    const log = git(["log", "--oneline"], repoPath);
    expect(log).not.toContain("should not commit");
  });
});

describe("GitService.hasChanges error path", () => {
  it("throws a GitError when git status fails (e.g. path is not a git repository)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
    const svc = new GitService(noopLogger);
    try {
      await expect(svc.hasChanges(dir)).rejects.toThrow(GitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GitService.commitAll error path", () => {
  it("throws a GitError (wrapping the underlying git failure) when `git add` fails", async () => {
    // A directory that isn't a git repository at all: `git add -A` fails
    // immediately, exercising commitAll's catch/GitError-wrapping branch.
    const dir = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-add-"));
    const svc = new GitService(noopLogger);
    try {
      await expect(svc.commitAll(dir, "should fail")).rejects.toThrow(GitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GitService.findWorktreeForBranch error path", () => {
  it("throws a GitError when `git worktree list` fails (e.g. not a git repository)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-wt-"));
    const svc = new GitService(noopLogger);
    try {
      await expect(svc.findWorktreeForBranch(dir, "some-branch")).rejects.toThrow(GitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GitService.removeWorktree best-effort failure path", () => {
  it("does not throw and logs a warning when the worktree removal itself fails", async () => {
    const repoPath = createTestRepo();
    const warnMessages: string[] = [];
    const logger = {
      info: () => {},
      warn: (_payload: unknown, message: string) => warnMessages.push(message),
      error: () => {},
      debug: () => {},
      fatal: () => {},
      child: () => logger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const svc = new GitService(logger);

    try {
      // Never-created worktree path: `git worktree remove` fails, but the
      // method must swallow the error (best-effort cleanup) rather than throw.
      await expect(
        svc.removeWorktree(repoPath, join(repoPath, ".worktrees", "never-existed")),
      ).resolves.toBeUndefined();
      expect(warnMessages).toContain("Failed to remove worktree (best-effort cleanup)");
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
  });
});
