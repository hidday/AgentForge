import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

let baseDir: string;

afterEach(() => {
  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
});

describe("RepoRunner.ensureWorkingDirectory", () => {
  it("creates the directory and logs when it does not exist", () => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(baseDir, "feature_my-branch"));
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("sanitizes non-alphanumeric characters in the branch name", () => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const runner = new RepoRunner(makeMockLogger() as never);

    const dir = runner.ensureWorkingDirectory(baseDir, "ai/LIN-123: fix bug!");

    expect(dir).toBe(join(baseDir, "ai_LIN-123__fix_bug_"));
    expect(existsSync(dir)).toBe(true);
  });

  it("does not log or fail when the directory already exists", () => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const first = runner.ensureWorkingDirectory(baseDir, "main");
    logger.info.mockClear();
    const second = runner.ensureWorkingDirectory(baseDir, "main");

    expect(second).toBe(first);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  it("creates the base path and logs when it does not exist", () => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const nested = join(baseDir, "nested", "repos");
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath(nested);

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(nested);
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
  });

  it("does not log or fail when the path already exists", () => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    runner.resolveRepoPath(baseDir);
    logger.info.mockClear();
    const dir = runner.resolveRepoPath(baseDir);

    expect(dir).toBe(baseDir);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("resolves a relative path to an absolute one", () => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const runner = new RepoRunner(makeMockLogger() as never);
    const relative = join(baseDir, "..", `${baseDir.split("/").pop()}`, "sub");

    const dir = runner.resolveRepoPath(relative);

    expect(dir.startsWith("/")).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });
});
