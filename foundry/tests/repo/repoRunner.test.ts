import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  let base: string;

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("creates the directory when it does not exist and logs it", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(base, "feature_my-branch"));
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("does not recreate or re-log an existing directory", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const first = runner.ensureWorkingDirectory(base, "main");
    expect(logger.info).toHaveBeenCalledTimes(1);

    const second = runner.ensureWorkingDirectory(base, "main");
    expect(second).toBe(first);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("sanitizes branch names containing characters unsafe for a directory name", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const runner = new RepoRunner(makeMockLogger() as never);

    const branchName = "feat/weird name!@#.branch";
    const dir = runner.ensureWorkingDirectory(base, branchName);
    const expectedSanitized = branchName.replace(/[^a-zA-Z0-9_-]/g, "_");

    expect(dir).toBe(join(base, expectedSanitized));
    expect(dir).not.toContain("/weird");
    expect(existsSync(dir)).toBe(true);
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  let base: string;

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("creates the base path when it does not exist and logs it", () => {
    base = join(mkdtempSync(join(tmpdir(), "repo-runner-test-")), "nested", "repo");
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath(base);

    expect(existsSync(dir)).toBe(true);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
  });

  it("does not recreate or re-log an existing path", () => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath(base);
    expect(dir).toBe(base);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
