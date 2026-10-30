import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("RepoRunner", () => {
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

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it doesn't exist", () => {
      const dir = runner.ensureWorkingDirectory(base, "ai/feature-1");
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "ai_feature-1"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(base, "feature/weird name!@#");
      expect(dir).toBe(join(base, "feature_weird_name___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const dir = runner.ensureWorkingDirectory(base, "ai/feature-1");
      logger.info.mockClear();

      const second = runner.ensureWorkingDirectory(base, "ai/feature-1");

      expect(second).toBe(dir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it doesn't exist", () => {
      const target = join(base, "nested", "repo");
      const dir = runner.resolveRepoPath(target);
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(target);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not re-create or re-log when the path already exists", () => {
      runner.resolveRepoPath(base);
      logger.info.mockClear();

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
