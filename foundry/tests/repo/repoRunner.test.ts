import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  let baseDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger = makeLogger();
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("creates the directory when it doesn't exist and logs it", () => {
    const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(baseDir, "feature_my-branch"));
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
    const dir = runner.ensureWorkingDirectory(baseDir, "feat/ab:c*d?.e");
    expect(dir).toBe(join(baseDir, "feat_ab_c_d__e"));
  });

  it("does not recreate or re-log when the directory already exists", () => {
    runner.ensureWorkingDirectory(baseDir, "feature/x");
    logger.info.mockClear();

    const dir = runner.ensureWorkingDirectory(baseDir, "feature/x");

    expect(existsSync(dir)).toBe(true);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  let baseDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger = makeLogger();
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns the resolved absolute path for an existing directory without creating or logging", () => {
    const result = runner.resolveRepoPath(baseDir);

    expect(result).toBe(join(baseDir));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("creates a missing nested directory and logs it", () => {
    const missing = join(baseDir, "nested", "repo-path");

    const result = runner.resolveRepoPath(missing);

    expect(existsSync(missing)).toBe(true);
    expect(result).toBe(missing);
    expect(logger.info).toHaveBeenCalledWith({ dir: missing }, "Created repo base path");
  });
});
