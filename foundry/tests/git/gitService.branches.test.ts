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
  const dir = mkdtempSync(join(tmpdir(), "gitservice-branches-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeLogger() {
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

describe("GitService — error-path branch coverage", () => {
  let repoPath: string;
  let svc: GitService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    repoPath = createTestRepo();
    logger = makeLogger();
    svc = new GitService(logger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("fetch() throws GitError when the repo has no 'origin' remote configured", async () => {
    await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
  });

  it("createWorktree() throws GitError when the start point doesn't exist", async () => {
    const wtPath = join(repoPath, ".worktrees", "bad-startpoint");
    await expect(
      svc.createWorktree(repoPath, wtPath, "some-branch", "origin/does-not-exist"),
    ).rejects.toThrow(GitError);
  });

  it("pruneWorktrees() catches the error and logs a warning instead of throwing", async () => {
    const badPath = join(repoPath, "does", "not", "exist");
    await expect(svc.pruneWorktrees(badPath)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: badPath }),
      "Failed to prune worktrees (best-effort cleanup)",
    );
  });

  it("findWorktreeForBranch() throws GitError for an invalid repo path", async () => {
    await expect(svc.findWorktreeForBranch("/nonexistent-repo-path", "main")).rejects.toThrow(
      GitError,
    );
  });

  it("removeWorktree() catches the error and logs a warning instead of throwing", async () => {
    const missingWtPath = join(repoPath, ".worktrees", "never-created");
    await expect(svc.removeWorktree(repoPath, missingWtPath)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath, worktreePath: missingWtPath }),
      "Failed to remove worktree (best-effort cleanup)",
    );
  });

  it("hasChanges() throws GitError for an invalid worktree path", async () => {
    await expect(svc.hasChanges("/nonexistent-repo-path")).rejects.toThrow(GitError);
  });

  it("commitAll() throws GitError for an invalid worktree path", async () => {
    await expect(svc.commitAll("/nonexistent-repo-path", "msg")).rejects.toThrow(GitError);
  });

  it("push() throws GitError when there is no 'origin' remote configured", async () => {
    await expect(svc.push(repoPath, "main")).rejects.toThrow(GitError);
  });
});

describe("GitService — remote-branch and full push/commitAndPush success paths", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-branches-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);
    logger = makeLogger();
    svc = new GitService(logger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("remoteBranchExists() returns false for a branch that was never pushed", async () => {
    expect(await svc.remoteBranchExists(repoPath, "never-pushed")).toBe(false);
  });

  it("remoteBranchExists() returns true once the branch has been pushed to origin", async () => {
    git(["checkout", "-b", "pushed-branch"], repoPath);
    git(["push", "-u", "origin", "pushed-branch"], repoPath);

    expect(await svc.remoteBranchExists(repoPath, "pushed-branch")).toBe(true);
  });

  it("commitAndPush() end-to-end: asserts branch, commits changes, and pushes to origin", async () => {
    git(["checkout", "-b", "feature/full-flow"], repoPath);
    writeFileSync(join(repoPath, "new-file.txt"), "hello world");

    await svc.commitAndPush(repoPath, "feature/full-flow", "Add new-file.txt");

    // The commit landed locally...
    const log = git(["log", "--oneline"], repoPath);
    expect(log).toContain("Add new-file.txt");
    // ...and was pushed to the bare origin.
    const remoteLog = git(["log", "--oneline", "feature/full-flow"], bareDir);
    expect(remoteLog).toContain("Add new-file.txt");
  });

  it("setupRunWorktree() warns when origin/<branch> already exists and resets the local branch to it", async () => {
    const branchName = "hidday/pry-200-existing-remote";
    // Push the branch to origin first, from a throwaway worktree, so that
    // setupRunWorktree() observes an existing origin/<branch>.
    const throwawayPath = join(repoPath, ".worktrees", "throwaway");
    await svc.createWorktree(repoPath, throwawayPath, branchName, "main");
    writeFileSync(join(throwawayPath, "extra.txt"), "extra");
    git(["add", "-A"], throwawayPath);
    git(["commit", "-m", "extra commit on remote"], throwawayPath);
    git(["push", "-u", "origin", branchName], throwawayPath);
    await svc.removeWorktree(repoPath, throwawayPath);

    const runId = "cafebabe-0000-0000-0000-000000000000";
    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(result.branchName).toBe(branchName);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath, branchName }),
      expect.stringContaining("origin/<branch> already exists"),
    );

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("setupRunWorktree() removes a pre-existing worktree occupying its target directory before recreating it", async () => {
    const runId = "deadc0de-0000-0000-0000-000000000000";
    const branchName = "hidday/pry-300-occupied-dir";
    const shortId = runId.slice(0, 8);
    const dirName = buildWorktreeDirName(shortId, branchName);
    const targetPath = join(repoPath, ".worktrees", dirName);

    // Occupy the exact directory setupRunWorktree() will target, with an
    // unrelated leftover branch checked out (simulating a stale worktree).
    await svc.createWorktree(repoPath, targetPath, "leftover-branch", "main");
    expect(existsSync(targetPath)).toBe(true);
    expect(await svc.currentBranch(targetPath)).toBe("leftover-branch");

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(result.worktreePath).toBe(targetPath);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(logger.warn).toHaveBeenCalledWith(
      { worktreePath: targetPath },
      "Worktree path already exists, removing first",
    );

    await svc.removeWorktree(repoPath, result.worktreePath);
  });
});
