import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
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
    it("creates the directory (sanitizing the branch name) when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch!");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "feature_my-branch_"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not log or fail when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "ai/lin-1");
      logger.info.mockClear();

      const dirAgain = runner.ensureWorkingDirectory(base, "ai/lin-1");

      expect(dirAgain).toBe(dir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the resolved base path when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const nested = join(base, "nested", "repo-path");

      const dir = runner.resolveRepoPath(nested);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(nested);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
