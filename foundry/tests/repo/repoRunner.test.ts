import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

describe("RepoRunner", () => {
  let baseDir: string;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger.info.mockClear();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const runner = new RepoRunner(logger as never);
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes branch names into safe directory names", () => {
      const runner = new RepoRunner(logger as never);
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/weird:branch name!");

      expect(dir).not.toContain(":");
      expect(dir).not.toContain(" ");
      expect(dir).not.toContain("!");
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-create or log when the directory already exists", () => {
      const runner = new RepoRunner(logger as never);
      const first = runner.ensureWorkingDirectory(baseDir, "feature/a");
      logger.info.mockClear();

      const second = runner.ensureWorkingDirectory(baseDir, "feature/a");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      const runner = new RepoRunner(logger as never);
      const target = join(baseDir, "nested", "repo-base");

      const resolved = runner.resolveRepoPath(target);

      expect(existsSync(resolved)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolved }, "Created repo base path");
    });

    it("does not log when the path already exists", () => {
      const runner = new RepoRunner(logger as never);
      runner.resolveRepoPath(baseDir);
      logger.info.mockClear();

      runner.resolveRepoPath(baseDir);

      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
