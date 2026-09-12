import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
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
    it("creates the directory when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dir }),
        "Created working directory",
      );
    });

    it("sanitizes unsafe characters in the branch name into underscores", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my branch!@#");

      expect(dir).toBe(join(baseDir, "feature_my_branch___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(baseDir, "ai/lin-1");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(baseDir, "ai/lin-1");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const target = join(baseDir, "nested", "repo-base");

      const dir = runner.resolveRepoPath(target);

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dir }),
        "Created repo base path",
      );
    });

    it("does not re-log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.resolveRepoPath(baseDir);
      logger.info.mockClear();
      const dir = runner.resolveRepoPath(baseDir);

      expect(dir).toBe(baseDir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
