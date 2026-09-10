import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, BranchMismatchError } from "../../src/git/gitService.js";

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

const warnCalls: unknown[][] = [];
const noopLogger = {
  info: () => {},
  warn: (...args: unknown[]) => {
    warnCalls.push(args);
  },
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("GitService — error and warn paths", () => {
  let repoPath: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    svc = new GitService(noopLogger);
    warnCalls.length = 0;
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("fetch() throws GitError when the repo has no origin remote", async () => {
    await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed/);
  });

  it("createWorktree() throws GitError when the branch already exists and resetIfExists is not set", async () => {
    git(["branch", "existing-branch"], repoPath);
    const wtPath = join(repoPath, ".worktrees", "wt-conflict");
    await expect(
      svc.createWorktree(repoPath, wtPath, "existing-branch", "main"),
    ).rejects.toThrow(GitError);
  });

  it("createWorktree() succeeds with resetIfExists when the branch already exists", async () => {
    git(["branch", "existing-branch2"], repoPath);
    const wtPath = join(repoPath, ".worktrees", "wt-reset");
    await expect(
      svc.createWorktree(repoPath, wtPath, "existing-branch2", "main", { resetIfExists: true }),
    ).resolves.toBeUndefined();
    expect(existsSync(wtPath)).toBe(true);
  });

  it("pruneWorktrees() warns instead of throwing when the repo path is invalid", async () => {
    await expect(svc.pruneWorktrees("/definitely/not/a/repo")).resolves.toBeUndefined();
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it("findWorktreeForBranch() throws GitError for an invalid repo path", async () => {
    await expect(svc.findWorktreeForBranch("/definitely/not/a/repo", "main")).rejects.toThrow(
      GitError,
    );
  });

  it("removeWorktree() warns instead of throwing when the worktree path doesn't exist", async () => {
    await svc.removeWorktree(repoPath, join(repoPath, ".worktrees", "never-existed"));
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it("hasChanges() throws GitError for an invalid worktree path", async () => {
    await expect(svc.hasChanges("/definitely/not/a/repo")).rejects.toThrow(GitError);
  });

  it("commitAll() throws GitError when the commit itself fails (e.g. a rejecting pre-commit hook)", async () => {
    const hooksDir = join(repoPath, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
    chmodSync(hookPath, 0o755);

    writeFileSync(join(repoPath, "blocked.txt"), "content");
    await expect(svc.commitAll(repoPath, "should fail")).rejects.toThrow(GitError);
  });

  it("push() throws GitError when there is no origin remote configured", async () => {
    await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
    await expect(svc.push(repoPath, "main")).rejects.toThrow(/git push failed/);
  });

  it("commitAndPush() runs assertBranch, commitAll, and push in sequence against a real remote", async () => {
    const bareDir = mkdtempSync(join(tmpdir(), "gitservice-err-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);

    writeFileSync(join(repoPath, "change.txt"), "content");
    await svc.commitAndPush(repoPath, "main", "commit and push");

    const log = git(["log", "--oneline"], bareDir);
    expect(log).toContain("commit and push");

    rmSync(bareDir, { recursive: true, force: true });
  });

  it("commitAndPush() throws BranchMismatchError before attempting to commit if on the wrong branch", async () => {
    git(["checkout", "-b", "other"], repoPath);
    writeFileSync(join(repoPath, "change.txt"), "content");
    await expect(svc.commitAndPush(repoPath, "main", "should not commit")).rejects.toThrow(
      BranchMismatchError,
    );
    // The change should remain uncommitted since assertBranch failed first.
    expect(await svc.hasChanges(repoPath)).toBe(true);
  });
});

describe("GitService — setupRunWorktree cleanup branches", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    svc = new GitService(noopLogger);
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-err-bare2-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);
    warnCalls.length = 0;
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("removes a pre-existing directory at the target worktree path before recreating it", async () => {
    const runId = "aaaaaaaa-1111-2222-3333-444444444444";
    const branchName = "hidday/pry-1-existing-dir";
    const shortId = runId.slice(0, 8);

    // Register a REAL worktree (for a different branch) at the exact path
    // setupRunWorktree will compute for `branchName`, so existsSync(worktreePath)
    // is true but findWorktreeForBranch(branchName) does NOT find it — this
    // exercises the "path already exists, removing first" branch specifically
    // (as opposed to the already-covered "stale worktree for this branch" case).
    const { buildWorktreeDirName } = await import("../../src/git/gitService.js");
    const dirName = buildWorktreeDirName(shortId, branchName);
    const targetPath = join(repoPath, ".worktrees", dirName);
    await svc.createWorktree(repoPath, targetPath, "unrelated-branch", "main");
    expect(existsSync(targetPath)).toBe(true);

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(result.worktreePath).toBe(targetPath);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("warns when origin already has the branch, and resets the local branch to the remote default", async () => {
    const runId = "bbbbbbbb-1111-2222-3333-444444444444";
    const branchName = "hidday/pry-2-remote-exists";

    // Push the branch to origin first so remoteBranchExists() is true.
    git(["push", "origin", `main:refs/heads/${branchName}`], repoPath);
    git(["fetch", "origin"], repoPath);

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(warnCalls.some((call) => String(call[1] ?? "").includes("already exists"))).toBe(true);

    await svc.removeWorktree(repoPath, result.worktreePath);
  });
});

describe("GitError and BranchMismatchError constructors", () => {
  it("GitError formats a message from an Error cause", () => {
    const err = new GitError("fetch", "/repo", new Error("network down"));
    expect(err.message).toBe("git fetch failed in /repo: network down");
    expect(err.name).toBe("GitError");
  });

  it("GitError formats a message from a non-Error cause via String()", () => {
    const err = new GitError("fetch", "/repo", "raw string failure");
    expect(err.message).toBe("git fetch failed in /repo: raw string failure");
  });

  it("BranchMismatchError reports the expected and actual branches", () => {
    const err = new BranchMismatchError("main", "feature", "/repo");
    expect(err.message).toBe(
      'Branch safety check failed in /repo: expected "main" but HEAD is on "feature"',
    );
    expect(err.name).toBe("BranchMismatchError");
  });
});
