import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "../../src/utils/logger.js";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("RepoRunner", () => {
  let tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-runner-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it does not exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const base = makeTmpDir();

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

      const expected = resolve(base, "feature_my-branch");
      expect(dir).toBe(expected);
      expect(existsSync(expected)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const base = makeTmpDir();

      const dir = runner.ensureWorkingDirectory(base, "feat/ab:c@123");

      expect(dir).toBe(resolve(base, "feat_ab_c_123"));
    });

    it("does not log or re-create the directory when it already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const base = makeTmpDir();

      const first = runner.ensureWorkingDirectory(base, "my-branch");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(base, "my-branch");

      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it does not exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const base = join(makeTmpDir(), "nested", "repo-base");

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(resolve(base));
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolve(base) }, "Created repo base path");
    });

    it("does not log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const base = makeTmpDir();

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(resolve(base));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
