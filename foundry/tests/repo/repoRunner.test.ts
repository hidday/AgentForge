import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(base, "feature-branch");

      const expected = resolve(base, "feature-branch");
      expect(dir).toBe(expected);
      expect(existsSync(expected)).toBe(true);
      expect(statSync(expected).isDirectory()).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(base, "feat/my branch!123");

      const expected = resolve(base, "feat_my_branch_123");
      expect(dir).toBe(expected);
      expect(existsSync(expected)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(base, "existing-branch");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(base, "existing-branch");

      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const nested = join(base, "nested", "repo-root");

      const dir = runner.resolveRepoPath(nested);

      expect(dir).toBe(resolve(nested));
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolve(nested) }, "Created repo base path");
    });

    it("returns the resolved path without creating or logging when it already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(resolve(base));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
