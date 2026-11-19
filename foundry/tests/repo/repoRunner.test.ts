import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  let base: string;

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("creates the working directory from basePath + sanitized branch name when missing", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory(base, "feature/my-branch_1");

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(base, "feature_my-branch_1"));
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("does not log or recreate the directory when it already exists", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory(base, "main");
    logger.info.mockClear();
    const dirAgain = runner.ensureWorkingDirectory(base, "main");

    expect(dirAgain).toBe(dir);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  let base: string;

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("creates the base path when missing and logs it", () => {
    const parent = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    base = join(parent, "nested", "repo-base");
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath(base);

    expect(existsSync(dir)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");

    rmSync(parent, { recursive: true, force: true });
    base = "";
  });

  it("does not recreate or log when the base path already exists", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    runner.resolveRepoPath(base);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
