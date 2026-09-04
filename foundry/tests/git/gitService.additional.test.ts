import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-additional-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeSpyLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
}

describe("GitService - error and warning paths", () => {
  let repoPath: string;
  let svc: GitService;
  let logger: ReturnType<typeof makeSpyLogger>;

  beforeEach(() => {
    repoPath = createTestRepo();
    logger = makeSpyLogger();
    svc = new GitService(logger as never);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("fetch() throws GitError when the repo path is invalid", async () => {
    await expect(svc.fetch("/nonexistent/path/xyz")).rejects.toThrow(GitError);
  });

  it("createWorktree() throws GitError when the underlying git command fails", async () => {
    await expect(
      svc.createWorktree("/nonexistent/path/xyz", "/tmp/wherever", "some-branch", "main"),
    ).rejects.toThrow(GitError);
  });

  it("pruneWorktrees() logs a warning instead of throwing when git fails", async () => {
    await expect(svc.pruneWorktrees("/nonexistent/path/xyz")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "/nonexistent/path/xyz" }),
      "Failed to prune worktrees (best-effort cleanup)",
    );
  });

  it("findWorktreeForBranch() throws GitError when the repo path is invalid", async () => {
    await expect(svc.findWorktreeForBranch("/nonexistent/path/xyz", "main")).rejects.toThrow(
      GitError,
    );
  });

  it("removeWorktree() logs a warning instead of throwing when the path isn't a real worktree", async () => {
    const notAWorktree = join(repoPath, "not-a-worktree");
    await expect(svc.removeWorktree(repoPath, notAWorktree)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath, worktreePath: notAWorktree }),
      "Failed to remove worktree (best-effort cleanup)",
    );
  });

  it("hasChanges() throws GitError when the path is invalid", async () => {
    await expect(svc.hasChanges("/nonexistent/path/xyz")).rejects.toThrow(GitError);
  });

  it("commitAll() throws GitError when 'git add' fails", async () => {
    await expect(svc.commitAll("/nonexistent/path/xyz", "msg")).rejects.toThrow(GitError);
  });

  it("push() throws GitError when there is no configured remote", async () => {
    await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
  });
});

describe("GitService - remoteBranchExists / setupRunWorktree with a real origin", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;
  let logger: ReturnType<typeof makeSpyLogger>;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-additional-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);
    logger = makeSpyLogger();
    svc = new GitService(logger as never);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("remoteBranchExists() returns true when the branch exists on origin", async () => {
    git(["push", "origin", "main:refs/heads/already-there"], repoPath);

    await expect(svc.remoteBranchExists(repoPath, "already-there")).resolves.toBe(true);
  });

  it("setupRunWorktree() warns (but still succeeds) when the branch already exists on origin", async () => {
    const branchName = "hidday/pry-500-already-remote";
    git(["push", "origin", `main:refs/heads/${branchName}`], repoPath);

    const runId = "cafebabe-3456-7890-abcd-ef1234567890";
    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(existsSync(result.worktreePath)).toBe(true);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath, branchName }),
      expect.stringContaining("origin/<branch> already exists"),
    );

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("setupRunWorktree() removes a worktree that already exists at the computed path before recreating it", async () => {
    const branchName = "hidday/pry-600-stale-path";
    const runId = "deadc0de-3456-7890-abcd-ef1234567890";
    const shortId = runId.slice(0, 8);
    const dirName = buildWorktreeDirName(shortId, branchName);
    const expectedPath = join(repoPath, ".worktrees", dirName);

    // Pre-create a real worktree (on an unrelated branch) at the exact path
    // setupRunWorktree will compute, simulating a leftover from a crashed run.
    await svc.createWorktree(repoPath, expectedPath, "leftover-placeholder", "main");
    expect(existsSync(expectedPath)).toBe(true);

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(result.worktreePath).toBe(expectedPath);
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: expectedPath }),
      "Worktree path already exists, removing first",
    );

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("commitAndPush() runs assertBranch + commitAll + push end-to-end successfully", async () => {
    const branchName = "hidday/pry-700-commit-and-push";
    const runId = "01234567-3456-7890-abcd-ef1234567890";
    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    writeFileSync(join(result.worktreePath, "new-file.txt"), "content");

    await svc.commitAndPush(result.worktreePath, branchName, "test commit message");

    const remoteLog = git(["log", "--oneline", `origin/${branchName}`], repoPath);
    expect(remoteLog).toContain("test commit message");

    await svc.removeWorktree(repoPath, result.worktreePath);
  });
});

describe("buildWorktreeDirName - slug truncation branch", () => {
  it("keeps only the leading parts that fit within the 30-char slug budget", () => {
    // "short" (5) fits; adding "-reallylongwordthatoverflows" (29 more, total
    // 34) exceeds the 30-char cap, so shortenSlug must stop and keep only
    // the parts accumulated so far -- exercising the `next.length > maxLen`
    // truncation branch with a partial (non-empty) result.
    const result = buildWorktreeDirName(
      "abcdefgh",
      "eng-1-short-reallylongwordthatoverflows-anotherword",
    );
    expect(result).toBe("run-abcdefgh-eng-1-short");
  });

  it("drops the slug entirely when even the first word alone exceeds the cap", () => {
    const result = buildWorktreeDirName(
      "abcdefgh",
      "eng-2-abcdefghijklmnopqrstuvwxyzabcdefgh",
    );
    expect(result).toBe("run-abcdefgh-eng-2");
  });
});

describe("GitError - non-Error cause", () => {
  it("stringifies a non-Error cause in the error message", () => {
    const err = new GitError("test-op", "/some/repo", "a raw string cause, not an Error");
    expect(err.message).toBe(
      "git test-op failed in /some/repo: a raw string cause, not an Error",
    );
    expect(err.name).toBe("GitError");
  });
});
