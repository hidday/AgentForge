import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
    it("creates the directory when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature_my-branch"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes branch names containing disallowed characters", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feat/ABC 123!@#");

      expect(dir).toBe(join(baseDir, "feat_ABC_123___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(baseDir, "main");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(baseDir, "main");
      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const target = join(baseDir, "nested", "repo-base");

      const resolved = runner.resolveRepoPath(target);

      expect(resolved).toBe(target);
      expect(existsSync(target)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: target }, "Created repo base path");
    });

    it("does not log or fail when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.resolveRepoPath(baseDir);
      expect(logger.info).not.toHaveBeenCalled();
      expect(first).toBe(join(baseDir));
    });
  });
});
