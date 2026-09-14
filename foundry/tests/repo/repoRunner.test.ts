import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it does not yet exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my branch!@#");

      expect(dir).toBe(join(base, "feature_my_branch___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(base, "ai/run-1");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(base, "ai/run-1");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it does not yet exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const target = join(base, "nested", "repo-base");

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(target);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not recreate or re-log when the path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.resolveRepoPath(base);
      logger.info.mockClear();
      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
