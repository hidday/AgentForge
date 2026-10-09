import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    it("creates the directory and logs when it does not exist", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(dir).toBe(join(baseDir, "feature_my-branch"));
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not recreate or log when the directory already exists", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/x");
      logger.info.mockClear();

      const second = runner.ensureWorkingDirectory(baseDir, "feature/x");

      expect(second).toBe(dir);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("sanitizes special characters in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "a/b c!@#$%^&*()");
      expect(dir).toBe(join(baseDir, "a_b_c__________"));
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it does not exist", () => {
      const target = join(baseDir, "nested", "repo-root");
      const resolved = runner.resolveRepoPath(target);

      expect(resolved).toBe(target);
      expect(existsSync(target)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: target }, "Created repo base path");
    });

    it("does not recreate or log when the path already exists", () => {
      runner.resolveRepoPath(baseDir);
      logger.info.mockClear();

      const resolved = runner.resolveRepoPath(baseDir);

      expect(resolved).toBe(baseDir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
