import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "reporunner-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it doesn't already exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(dir).toBe(resolve(baseDir, "feature_my-branch"));
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes special characters out of the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(baseDir, "alice/PRY-42: fix bug!!");

      expect(dir).toBe(resolve(baseDir, "alice_PRY-42__fix_bug__"));
    });

    it("does not recreate or log again when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(baseDir, "feature/x");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(baseDir, "feature/x");
      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it doesn't already exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const target = join(baseDir, "nested", "repo-base");

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(resolve(target));
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not recreate or log again when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      mkdirSync(join(baseDir, "already-there"));

      const dir = runner.resolveRepoPath(join(baseDir, "already-there"));

      expect(dir).toBe(resolve(join(baseDir, "already-there")));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
