import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GitService, GitError, buildWorktreeDirName } from "../../src/git/gitService.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-errorpaths-"));
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
  warn: vi.fn(),
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("GitError", () => {
  it("stringifies a non-Error cause instead of reading .message", () => {
    const err = new GitError("fetch", "/repo", "a plain string failure");
    expect(err.message).toBe("git fetch failed in /repo: a plain string failure");
  });
});

describe("buildWorktreeDirName slug truncation", () => {
  it("drops a slug part that alone would exceed the 30-char cap", () => {
    const name = buildWorktreeDirName(
      "abcdefgh",
      "eng-42-thisisaveryverylongwordexceedingthirtychars-two",
    );
    // The oversized first part breaks the loop before anything is accumulated,
    // so the slug is empty and only the base + issue id remain.
    expect(name).toBe("run-abcdefgh-eng-42");
  });

  it("stops appending further slug parts once the running total would exceed the 30-char cap", () => {
    const name = buildWorktreeDirName("abcdefgh", "eng-42-alphabetlength-bravocharlie-two");
    const slugPart = name.replace("run-abcdefgh-eng-42-", "");
    expect(slugPart.length).toBeLessThanOrEqual(30);
    expect(slugPart).toBe("alphabetlength-bravocharlie");
  });
});

describe("GitService error paths", () => {
  let repoPath: string;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    svc = new GitService(noopLogger);
    noopLogger.warn.mockClear();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("fetch throws a GitError when the repo has no configured origin remote", async () => {
    await expect(svc.fetch(repoPath)).rejects.toThrow(GitError);
    await expect(svc.fetch(repoPath)).rejects.toThrow(/git fetch failed/);
  });

  it("fetch resolves successfully when origin is reachable", async () => {
    const remotePath = mkdtempSync(join(tmpdir(), "gitservice-remote-"));
    try {
      git(["init", "--bare"], remotePath);
      git(["remote", "add", "origin", remotePath], repoPath);
      await expect(svc.fetch(repoPath)).resolves.toBeUndefined();
    } finally {
      rmSync(remotePath, { recursive: true, force: true });
    }
  });

  it("createWorktree throws a GitError when the start point does not exist", async () => {
    const wtPath = join(repoPath, "..", "worktree-invalid-startpoint");
    await expect(
      svc.createWorktree(repoPath, wtPath, "feature-x", "does-not-exist-ref"),
    ).rejects.toThrow(GitError);
    await expect(
      svc.createWorktree(repoPath, wtPath, "feature-x", "does-not-exist-ref"),
    ).rejects.toThrow(/worktree add failed/);
    rmSync(wtPath, { recursive: true, force: true });
  });

  it("pruneWorktrees logs a warning and does not throw when the underlying git command fails", async () => {
    const notAGitRepo = mkdtempSync(join(tmpdir(), "gitservice-not-a-repo-"));
    try {
      await expect(svc.pruneWorktrees(notAGitRepo)).resolves.toBeUndefined();
      expect(noopLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: notAGitRepo }),
        "Failed to prune worktrees (best-effort cleanup)",
      );
    } finally {
      rmSync(notAGitRepo, { recursive: true, force: true });
    }
  });
});
