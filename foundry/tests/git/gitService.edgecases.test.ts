import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-edge-test-"));
  git(["init", "--initial-branch", "main"], dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: (): unknown => logger,
  };
  return logger;
}

describe("GitService.setupRunWorktree edge cases", () => {
  let repoPath: string;
  let bareDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-edge-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);
    logger = makeLogger();
    svc = new GitService(logger as never);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("removes and recreates the worktree directory when it already exists on disk at the deterministic path", async () => {
    const runId = "11112222-3333-4444-5555-666677778888";
    const branchName = "hidday/pry-55-dup-worktree";

    const first = await svc.setupRunWorktree(repoPath, runId, "main", branchName);
    expect(existsSync(first.worktreePath)).toBe(true);

    // Calling again with the *same* runId/branchName makes setupRunWorktree
    // compute the identical deterministic worktreePath, which now already
    // exists on disk from the first call (and was never cleaned up).
    const second = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(second.worktreePath).toBe(first.worktreePath);
    expect(existsSync(second.worktreePath)).toBe(true);
    expect(await svc.currentBranch(second.worktreePath)).toBe(branchName);
    expect(logger.warn).toHaveBeenCalledWith(
      { worktreePath: first.worktreePath },
      "Worktree path already exists, removing first",
    );

    await svc.removeWorktree(repoPath, second.worktreePath);
  });

  it("warns but still succeeds when origin/<branch> already exists remotely", async () => {
    const branchName = "hidday/pry-66-already-pushed";

    // Create + push the branch once so origin/<branch> exists remotely, then
    // tear down the local worktree (the branch stays pushed on the remote).
    const setupRunId = "aaaa1111-2222-3333-4444-555566667777";
    const setup = await svc.setupRunWorktree(repoPath, setupRunId, "main", branchName);
    await svc.push(setup.worktreePath, branchName);
    await svc.removeWorktree(repoPath, setup.worktreePath);

    logger.warn.mockClear();

    // A brand-new runId produces a different deterministic worktreePath, so
    // the existsSync()/findWorktreeForBranch() guards are not what fire here —
    // only the remote-branch-exists check should warn.
    const runId = "bbbb1111-2222-3333-4444-555566667777";
    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(existsSync(result.worktreePath)).toBe(true);
    expect(result.worktreePath).not.toBe(setup.worktreePath);
    expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
    expect(logger.warn).toHaveBeenCalledWith(
      { repoPath, branchName },
      "origin/<branch> already exists; local branch will be reset to startPoint. " +
        "If the remote has unmerged commits, the final push will fail (non-fast-forward) " +
        "and must be resolved manually.",
    );

    await svc.removeWorktree(repoPath, result.worktreePath);
  });

  it("does not warn about an already-existing remote branch when the branch has never been pushed", async () => {
    const runId = "cccc1111-2222-3333-4444-555566667777";
    const branchName = "hidday/pry-77-never-pushed";

    const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

    expect(
      logger.warn.mock.calls.some(
        (call) =>
          typeof call[1] === "string" && call[1].includes("origin/<branch> already exists"),
      ),
    ).toBe(false);

    await svc.removeWorktree(repoPath, result.worktreePath);
  });
});
