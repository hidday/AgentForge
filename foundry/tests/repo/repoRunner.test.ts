import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RepoRunner", () => {
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

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature_my-branch"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/weird branch!@#");
      expect(dir).toBe(join(baseDir, "feature_weird_branch___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-create or re-log when the directory already exists", () => {
      const dir1 = runner.ensureWorkingDirectory(baseDir, "same-branch");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const dir2 = runner.ensureWorkingDirectory(baseDir, "same-branch");
      expect(dir2).toBe(dir1);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const nested = join(baseDir, "nested", "repo-root");
      const dir = runner.resolveRepoPath(nested);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(nested);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not re-create or re-log when the path already exists", () => {
      runner.resolveRepoPath(baseDir);
      expect(logger.info).not.toHaveBeenCalled();

      const dir = runner.resolveRepoPath(baseDir);
      expect(dir).toBe(baseDir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
