import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the directory when it does not exist and logs it", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(base, "feature_my-branch"));
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("does not log or fail when the directory already exists", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir1 = runner.ensureWorkingDirectory(base, "my-branch");
    logger.info.mockClear();
    const dir2 = runner.ensureWorkingDirectory(base, "my-branch");

    expect(dir1).toBe(dir2);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("sanitizes special characters in the branch name into underscores", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);
    const branchName = "ai/ENG-42: fix bug!";

    const dir = runner.ensureWorkingDirectory(base, branchName);

    const expectedSanitized = branchName.replace(/[^a-zA-Z0-9_-]/g, "_");
    expect(dir).toBe(join(base, expectedSanitized));
    expect(dir).not.toContain("/ENG");
    expect(dir).not.toContain("!");
    expect(dir).not.toContain(":");
  });

  it("creates nested directories recursively", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);
    const nestedBase = join(base, "nested", "deeper");

    const dir = runner.ensureWorkingDirectory(nestedBase, "branch");

    expect(existsSync(dir)).toBe(true);
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("returns the resolved absolute path for an existing directory without creating anything", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath(base);

    expect(dir).toBe(base);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("creates the repo base path when it does not exist and logs it", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);
    const target = join(base, "does", "not", "exist", "yet");

    const dir = runner.resolveRepoPath(target);

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(target);
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
  });

  it("resolves a relative path against the current working directory", () => {
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath(".");

    expect(dir).toBe(process.cwd());
  });
});
