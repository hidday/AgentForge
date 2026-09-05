import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-runner-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it doesn't exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const result = runner.ensureWorkingDirectory(dir, "feature/my-branch");

      const expected = resolve(dir, "feature_my-branch");
      expect(result).toBe(expected);
      expect(existsSync(expected)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        { dir: expected },
        "Created working directory",
      );
    });

    it("sanitizes branch names by replacing non-alphanumeric characters with underscores", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const result = runner.ensureWorkingDirectory(dir, "feat/foo bar!baz");

      expect(result).toBe(resolve(dir, "feat_foo_bar_baz"));
    });

    it("does not recreate or log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.ensureWorkingDirectory(dir, "branch-a");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(dir, "branch-a");

      expect(second).toBe(resolve(dir, "branch-a"));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const basePath = join(dir, "new-base");

      const result = runner.resolveRepoPath(basePath);

      expect(result).toBe(resolve(basePath));
      expect(existsSync(basePath)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolve(basePath) }, "Created repo base path");
    });

    it("does not recreate or log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.resolveRepoPath(dir);
      logger.info.mockClear();
      const result = runner.resolveRepoPath(dir);

      expect(result).toBe(resolve(dir));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
