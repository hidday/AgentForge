import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-gaps2-test-"));
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

describe("GitError", () => {
  it("stringifies a non-Error cause in the constructed message", () => {
    const err = new GitError("push", "/repo", "a plain string failure");
    expect(err.message).toBe("git push failed in /repo: a plain string failure");
    expect(err.name).toBe("GitError");
  });
});

describe("buildWorktreeDirName - slug length truncation", () => {
  it("truncates the slug when adding the next word would exceed the 30-char cap", () => {
    // "firstlongword12" (15 chars) + "-" + "secondlongword34" (16 chars) = 32 > 30,
    // so shortenSlug should break before appending the second word.
    const result = buildWorktreeDirName(
      "abcdefgh",
      "pry-751-firstlongword12-secondlongword34-third",
    );
    expect(result).toBe("run-abcdefgh-pry-751-firstlongword12");
  });
});

describe("GitService (gaps 2) - prune/remove worktree failure paths", () => {
  let repoPath: string;

  beforeEach(() => {
    warnCalls.length = 0;
    repoPath = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("pruneWorktrees swallows the error and logs a warn when the exec call fails", async () => {
    const svc = new GitService(noopLogger);
    // Not a git repository at all -- `git worktree prune` will fail here.
    const notARepo = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    try {
      await svc.pruneWorktrees(notARepo);
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0][1]).toContain("Failed to prune worktrees");
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("removeWorktree swallows the error and logs a warn when the worktree path was never registered", async () => {
    const svc = new GitService(noopLogger);
    const bogusWorktreePath = join(tmpdir(), "never-registered-worktree-path");

    await svc.removeWorktree(repoPath, bogusWorktreePath);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][1]).toContain("Failed to remove worktree");
  });
});
