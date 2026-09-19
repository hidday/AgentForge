import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
    it("creates the branch working directory when it does not exist, and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/add-thing");

      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ dir }), "Created working directory");
    });

    it("sanitizes unsafe branch name characters into underscores", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/lin-1: fix bug?");

      expect(dir).toBe(join(baseDir, "feature_lin-1__fix_bug_"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(baseDir, "feature/x");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(baseDir, "feature/x");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist, and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const missing = join(baseDir, "nested", "repo-root");

      const dir = runner.resolveRepoPath(missing);

      expect(dir).toBe(missing);
      expect(existsSync(missing)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dir: missing }),
        "Created repo base path",
      );
    });

    it("does not recreate or re-log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath(baseDir);
      logger.info.mockClear();
      const dir = runner.resolveRepoPath(baseDir);

      expect(dir).toBe(baseDir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
