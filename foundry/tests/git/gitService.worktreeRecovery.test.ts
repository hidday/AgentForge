import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, buildWorktreeDirName } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-recovery-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeLogger() {
  const warnMessages: string[] = [];
  return {
    logger: {
      info: () => {},
      warn: (_payload: unknown, message: string) => {
        warnMessages.push(message);
      },
      error: () => {},
      debug: () => {},
      fatal: () => {},
      child: () => makeLogger().logger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    warnMessages,
  };
}

describe("GitService.setupRunWorktree recovery paths", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-recovery-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("removes a pre-existing directory at the computed worktree path before recreating it", async () => {
    const { logger, warnMessages } = makeLogger();
    svc = new GitService(logger);

    const runId = "cafefeed-3456-7890-abcd-ef1234567890";
    const branchName = "hidday/pry-77-collision-branch";
    const shortId = runId.slice(0, 8);
    const dirName = buildWorktreeDirName(shortId, branchName);
    const computedPath = join(repoPath, ".worktrees", dirName);

    // Pre-occupy the exact path setupRunWorktree will compute, with an
    // unrelated but valid worktree/branch.
    await svc.createWorktree(repoPath, computedPath, "unrelated-branch", "main");
    expect(existsSync(computedPath)).toBe(true);

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(result.worktreePath).toBe(computedPath);
    expect(existsSync(computedPath)).toBe(true);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(warnMessages).toContain("Worktree path already exists, removing first");

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("warns when origin/<branch> already exists and still succeeds by resetting the local branch", async () => {
    const { logger, warnMessages } = makeLogger();
    svc = new GitService(logger);

    const branchName = "hidday/pry-88-existing-remote";
    // Publish the branch to origin, then remove the local copy so only the
    // remote-tracking ref remains.
    git(["checkout", "-b", branchName], repoPath);
    git(["push", "origin", branchName], repoPath);
    git(["checkout", "main"], repoPath);
    git(["branch", "-D", branchName], repoPath);

    const runId = "beadfeed-3456-7890-abcd-ef1234567890";
    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(existsSync(result.worktreePath)).toBe(true);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(
      warnMessages.some((m) => m.includes("origin/<branch> already exists")),
    ).toBe(true);

    await svc.removeWorktree(repoPath, result.worktreePath);
  });
});
