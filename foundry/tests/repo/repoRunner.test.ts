import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  let base: string;
  let logger: ReturnType<typeof makeLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger = makeLogger();
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the working directory when it does not already exist and logs it", () => {
    const dir = runner.ensureWorkingDirectory(base, "ai/lin-1");

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(resolve(base, "ai_lin-1"));
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("sanitizes characters in the branch name that are not alphanumeric, underscore, or hyphen", () => {
    const dir = runner.ensureWorkingDirectory(base, "feature/ENG-123: fix bug!");

    expect(dir).toBe(resolve(base, "feature_ENG-123__fix_bug_"));
    expect(existsSync(dir)).toBe(true);
  });

  it("does not re-create or re-log when the directory already exists", () => {
    const dir = runner.ensureWorkingDirectory(base, "ai/lin-1");
    logger.info.mockClear();

    const secondCall = runner.ensureWorkingDirectory(base, "ai/lin-1");

    expect(secondCall).toBe(dir);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  let base: string;
  let logger: ReturnType<typeof makeLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger = makeLogger();
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("resolves and creates a nested repo base path that does not yet exist", () => {
    const target = join(base, "nested", "repo-root");

    const dir = runner.resolveRepoPath(target);

    expect(dir).toBe(resolve(target));
    expect(existsSync(dir)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
  });

  it("does not log or fail when the path already exists", () => {
    runner.resolveRepoPath(base);
    logger.info.mockClear();

    const dir = runner.resolveRepoPath(base);

    expect(dir).toBe(resolve(base));
    expect(logger.info).not.toHaveBeenCalled();
  });
});
