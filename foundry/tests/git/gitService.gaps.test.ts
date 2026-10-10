import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-gaps-test-"));
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

describe("GitService (gaps)", () => {
  let repoPath: string;
  let bareDir: string;
  let svc: GitService;

  beforeEach(() => {
    warnCalls.length = 0;
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-gaps-bare-"));
    git(["clone", "--bare", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "origin"], repoPath);
    svc = new GitService(noopLogger);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  describe("setupRunWorktree", () => {
    it("removes a pre-existing directory already at the deterministic worktree path", async () => {
      const runId = "11111111-2222-3333-4444-555555555555";
      const branchName = "hidday/wtx-1-first-pass";

      const first = await svc.setupRunWorktree(repoPath, runId, "main", branchName);
      expect(existsSync(first.worktreePath)).toBe(true);

      // Calling it again with the SAME runId + branchName computes the same
      // deterministic worktreePath, which still exists on disk from the
      // first call (not removed). This exercises the "worktree path already
      // exists, removing first" branch.
      const second = await svc.setupRunWorktree(repoPath, runId, "main", branchName);
      expect(second.worktreePath).toBe(first.worktreePath);
      expect(existsSync(second.worktreePath)).toBe(true);
      expect(await svc.currentBranch(second.worktreePath)).toBe(branchName);

      const sawRemovalWarning = warnCalls.some(
        (args) => typeof args[1] === "string" && args[1].includes("already exists, removing first"),
      );
      expect(sawRemovalWarning).toBe(true);

      await svc.removeWorktree(repoPath, second.worktreePath);
    });

    it("warns and resets the local branch when origin/<branch> already exists remotely", async () => {
      const branchName = "hidday/wtx-2-remote-exists";
      // Create the branch directly on the bare "origin" without ever
      // creating a local branch or worktree for it in repoPath.
      git(["push", "origin", `main:refs/heads/${branchName}`], repoPath);

      const runId = "66666666-7777-8888-9999-000000000000";
      const result = await svc.setupRunWorktree(repoPath, runId, "main", branchName);

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(await svc.currentBranch(result.worktreePath)).toBe(branchName);
      expect(await svc.remoteBranchExists(repoPath, branchName)).toBe(true);

      const sawRemoteExistsWarning = warnCalls.some(
        (args) =>
          typeof args[1] === "string" &&
          args[1].includes("origin/<branch> already exists"),
      );
      expect(sawRemoteExistsWarning).toBe(true);

      await svc.removeWorktree(repoPath, result.worktreePath);
    });
  });
});
