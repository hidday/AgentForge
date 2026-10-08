import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  GitService,
  BranchMismatchError,
  GitError,
  buildWorktreeDirName,
} from "../../src/git/gitService.js";

// Companion to gitService.test.ts covering failure paths, push /
// commitAndPush, and the setupRunWorktree recovery warnings. Uses real temp
// repos (same convention as the main test file) plus a bare "origin".

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitservice-err-"));
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
    child: () => logger,
  };
  return logger;
}

describe("GitError", () => {
  it("formats an Error cause using its message", () => {
    const err = new GitError("push", "/repo", new Error("rejected"));
    expect(err.name).toBe("GitError");
    expect(err.message).toBe("git push failed in /repo: rejected");
  });

  it("stringifies a non-Error cause", () => {
    expect(new GitError("fetch", "/r", 128).message).toBe("git fetch failed in /r: 128");
  });
});

describe("buildWorktreeDirName slug length cap", () => {
  it("stops adding slug parts once the 30-char limit would be exceeded", () => {
    // "aaaaaaaaaa-bbbbbbbbbb" is 21 chars; adding "-cccccccccc" would make 32.
    expect(buildWorktreeDirName("abcd1234", "eng-1-aaaaaaaaaa-bbbbbbbbbb-cccccccccc")).toBe(
      "run-abcd1234-eng-1-aaaaaaaaaa-bbbbbbbbbb",
    );
  });

  it("drops the slug when even the first part is longer than 30 chars", () => {
    expect(buildWorktreeDirName("abcd1234", `eng-1-${"x".repeat(31)}`)).toBe(
      "run-abcd1234-eng-1",
    );
  });

  it("returns the base name for an empty branch", () => {
    expect(buildWorktreeDirName("abcd1234", "")).toBe("run-abcd1234");
  });
});

describe("GitService failure paths outside a git repository", () => {
  let notRepo: string;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitService;

  beforeEach(() => {
    notRepo = mkdtempSync(join(tmpdir(), "gitservice-norepo-"));
    logger = makeLogger();
    svc = new GitService(logger as never);
  });

  afterEach(() => {
    rmSync(notRepo, { recursive: true, force: true });
  });

  it.each([
    ["fetch", (s: GitService, p: string) => s.fetch(p), "git fetch failed in"],
    [
      "findWorktreeForBranch",
      (s: GitService, p: string) => s.findWorktreeForBranch(p, "x"),
      "git worktree list failed in",
    ],
    ["hasChanges", (s: GitService, p: string) => s.hasChanges(p), "git status failed in"],
    ["commitAll", (s: GitService, p: string) => s.commitAll(p, "msg"), "git commit failed in"],
    ["push", (s: GitService, p: string) => s.push(p, "main"), "git push failed in"],
  ])("%s rejects with a GitError naming the operation and cwd", async (_n, call, prefix) => {
    const err = await call(svc, notRepo).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message.startsWith(`${prefix} ${notRepo}: `)).toBe(true);
  });

  it("remoteBranchExists returns false instead of throwing", async () => {
    await expect(svc.remoteBranchExists(notRepo, "main")).resolves.toBe(false);
  });

  it("pruneWorktrees swallows the failure and logs a warning", async () => {
    await expect(svc.pruneWorktrees(notRepo)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: notRepo, error: expect.any(String) }),
      "Failed to prune worktrees (best-effort cleanup)",
    );
  });

  it("removeWorktree swallows the failure and logs a warning", async () => {
    await expect(svc.removeWorktree(notRepo, join(notRepo, "wt"))).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: notRepo,
        worktreePath: join(notRepo, "wt"),
        error: expect.any(String),
      }),
      "Failed to remove worktree (best-effort cleanup)",
    );
  });
});

describe("GitService with a bare origin", () => {
  let repoPath: string;
  let bareDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitService;

  beforeEach(() => {
    repoPath = createTestRepo();
    bareDir = mkdtempSync(join(tmpdir(), "gitservice-err-bare-"));
    git(["clone", "--bare", "-q", repoPath, bareDir], tmpdir());
    git(["remote", "add", "origin", bareDir], repoPath);
    git(["fetch", "-q", "origin"], repoPath);
    logger = makeLogger();
    svc = new GitService(logger as never);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  });

  it("createWorktree without resetIfExists fails with GitError when the branch already exists", async () => {
    git(["branch", "taken", "main"], repoPath);
    const wt = join(repoPath, ".worktrees", "wt-taken");

    const err = await svc.createWorktree(repoPath, wt, "taken", "main").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toContain(`git worktree add failed in ${repoPath}`);
    expect(existsSync(wt)).toBe(false);
  });

  it("remoteBranchExists returns true for a branch present on origin", async () => {
    expect(await svc.remoteBranchExists(repoPath, "main")).toBe(true);
    expect(await svc.remoteBranchExists(repoPath, "nope")).toBe(false);
  });

  it("push publishes the branch to origin", async () => {
    git(["checkout", "-q", "-b", "feature"], repoPath);
    writeFileSync(join(repoPath, "f.txt"), "x");
    git(["add", "."], repoPath);
    git(["commit", "-q", "-m", "feat"], repoPath);

    await svc.push(repoPath, "feature");

    expect(git(["rev-parse", "feature"], bareDir)).toBe(git(["rev-parse", "HEAD"], repoPath));
  });

  it("push fails with GitError when the branch does not exist", async () => {
    const err = await svc.push(repoPath, "ghost-branch").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toContain(`git push failed in ${repoPath}`);
  });

  it("commitAndPush commits dirty changes and pushes them to origin", async () => {
    git(["checkout", "-q", "-b", "work"], repoPath);
    writeFileSync(join(repoPath, "new.txt"), "content");

    await svc.commitAndPush(repoPath, "work", "Add new.txt");

    expect(git(["log", "-1", "--format=%s", "work"], bareDir)).toBe("Add new.txt");
    expect(git(["ls-tree", "--name-only", "work"], bareDir).split("\n")).toContain("new.txt");
  });

  it("commitAndPush refuses to commit when HEAD is on a different branch", async () => {
    writeFileSync(join(repoPath, "new.txt"), "content");

    const err = await svc.commitAndPush(repoPath, "work", "msg").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BranchMismatchError);
    expect((err as Error).message).toContain('expected "work" but HEAD is on "main"');
    // Nothing committed, nothing pushed.
    expect(git(["log", "--format=%s"], repoPath)).toBe("initial");
    expect(await svc.remoteBranchExists(repoPath, "work")).toBe(false);
  });

  it("commitAll wraps a failing commit in GitError", async () => {
    writeFileSync(join(repoPath, "new.txt"), "content");
    // A pre-commit hook that always fails makes `git commit` exit non-zero.
    const hook = join(repoPath, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n", { mode: 0o755 });

    const err = await svc.commitAll(repoPath, "msg").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toBe(`git commit failed in ${repoPath}: hook says no`);
  });

  it("setupRunWorktree removes a leftover directory at the target path before recreating", async () => {
    const runId = "cafebabe-0000-0000-0000-000000000000";
    const branch = "eng-5-redo";
    const first = await svc.setupRunWorktree(repoPath, runId, "main", branch);
    writeFileSync(join(first.worktreePath, "scratch.txt"), "leftover");
    logger.warn.mockClear();

    const second = await svc.setupRunWorktree(repoPath, runId, "main", branch);

    expect(second.worktreePath).toBe(first.worktreePath);
    expect(logger.warn).toHaveBeenCalledWith(
      { worktreePath: first.worktreePath },
      "Worktree path already exists, removing first",
    );
    // The fresh worktree does not carry the leftover untracked file.
    expect(existsSync(join(second.worktreePath, "scratch.txt"))).toBe(false);
    expect(await svc.currentBranch(second.worktreePath)).toBe(branch);
  });

  it("setupRunWorktree warns and resets to the start point when origin already has the branch", async () => {
    const branch = "eng-6-existing";
    // Put a divergent commit on origin/<branch>.
    git(["checkout", "-q", "-b", branch], repoPath);
    writeFileSync(join(repoPath, "remote-only.txt"), "r");
    git(["add", "."], repoPath);
    git(["commit", "-q", "-m", "remote only"], repoPath);
    git(["push", "-q", "origin", branch], repoPath);
    git(["checkout", "-q", "main"], repoPath);

    const result = await svc.setupRunWorktree(
      repoPath,
      "feedface-0000-0000-0000-000000000000",
      "main",
      branch,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      { repoPath, branchName: branch },
      expect.stringContaining("origin/<branch> already exists"),
    );
    // Local branch was reset to origin/main, so the remote-only commit is absent.
    expect(existsSync(join(result.worktreePath, "remote-only.txt"))).toBe(false);
    expect(git(["rev-parse", "HEAD"], result.worktreePath)).toBe(
      git(["rev-parse", "origin/main"], repoPath),
    );
  });

  it("setupRunWorktree surfaces fetch failures as GitError", async () => {
    rmSync(bareDir, { recursive: true, force: true });
    mkdirSync(bareDir); // empty dir: not a git repo → fetch fails

    const err = await svc
      .setupRunWorktree(repoPath, "0badf00d-0000", "main", "eng-7-x")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toContain(`git fetch failed in ${repoPath}`);
  });
});
