import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService } from "../../src/git/gitService.js";

// Covers two setupRunWorktree branches that the primary gitService.test.ts
// (22 tests) does not exercise: the deterministic worktree path already
// existing on disk, and origin/<branchName> already existing on the remote.

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

describe("GitService.setupRunWorktree additional branches", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;
  let warnMessages: string[];

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-branches-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);

    warnMessages = [];
    const logger = {
      info: () => {},
      warn: (meta: unknown, msg: string) => {
        warnMessages.push(msg);
      },
      error: () => {},
      debug: () => {},
      fatal: () => {},
      child: () => logger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    svc = new GitService(logger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("warns and recreates when the deterministic worktree path already exists on disk", async () => {
    const runId = "aaaaaaaa-0000-0000-0000-000000000000";
    const branchName = "hidday/pry-1-preexisting-path";

    // Pre-register an actual (valid) git worktree for a *different* branch at the
    // exact deterministic path setupRunWorktree will compute for this runId/branchName,
    // so existsSync(worktreePath) is true and git can genuinely remove it first.
    const shortId = runId.slice(0, 8);
    const expectedDir = join(repoPath, ".worktrees", `run-${shortId}-pry-1-preexisting-path`);
    await svc.createWorktree(repoPath, expectedDir, "leftover-placeholder-branch", "main");
    expect(existsSync(expectedDir)).toBe(true);

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(result.worktreePath).toBe(expectedDir);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(warnMessages).toContain("Worktree path already exists, removing first");

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("warns when origin/<branchName> already exists on the remote", async () => {
    const branchName = "hidday/pry-2-remote-exists";
    // Push a branch with this name to the bare remote, so remoteBranchExists() is true.
    git(["checkout", "-b", branchName], repoPath);
    git(["push", "origin", branchName], repoPath);
    git(["checkout", "main"], repoPath);

    const runId = "bbbbbbbb-0000-0000-0000-000000000000";
    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(existsSync(result.worktreePath)).toBe(true);
    expect(
      warnMessages.some((m) => m.includes("origin/<branch> already exists")),
    ).toBe(true);

    await svc.removeWorktree(repoPath, result.worktreePath);
  });
});
