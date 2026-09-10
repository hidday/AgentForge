import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it doesn't exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(tmpDir, "feature-branch");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info.mock.calls[0]?.[1]).toBe("Created working directory");
    });

    it("does not recreate or log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(tmpDir, "feature-branch");
      logger.info.mockClear();

      const dirAgain = runner.ensureWorkingDirectory(tmpDir, "feature-branch");

      expect(dirAgain).toBe(dir);
      expect(existsSync(dirAgain)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("sanitizes special characters in the branch name to [a-zA-Z0-9_-]", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(tmpDir, "feature/foo bar!");

      expect(dir).toBe(join(tmpDir, "feature_foo_bar_"));
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it doesn't exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const target = join(tmpDir, "nested", "base");

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(target);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info.mock.calls[0]?.[1]).toBe("Created repo base path");
    });

    it("does not recreate or log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath(tmpDir);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
