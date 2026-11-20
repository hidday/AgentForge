import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe("RepoRunner", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not yet exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "ai/lin-1");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "ai_lin-1"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/awesome thing!@#");

      expect(dir).toBe(join(baseDir, "feature_awesome_thing___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-create or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(baseDir, "ai/lin-1");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(baseDir, "ai/lin-1");

      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("returns the resolved absolute path for an existing directory without creating or logging", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.resolveRepoPath(baseDir);

      expect(dir).toBe(baseDir);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the base path and logs when it does not exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const missing = join(baseDir, "nested", "workspace");

      const dir = runner.resolveRepoPath(missing);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(missing);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });
  });
});
