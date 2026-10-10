import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "rr-test-"));
    tempDirs.push(dir);
    return dir;
  }

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it does not yet exist", () => {
      const base = makeTempDir();
      const logger = buildLogger();
      const runner = new RepoRunner(logger as never);

      const result = runner.ensureWorkingDirectory(base, "feature/my-branch");

      const expectedDir = resolve(base, "feature_my-branch");
      expect(result).toBe(expectedDir);
      expect(existsSync(expectedDir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: expectedDir }, "Created working directory");
    });

    it("sanitizes branch names with special characters", () => {
      const base = makeTempDir();
      const logger = buildLogger();
      const runner = new RepoRunner(logger as never);

      const result = runner.ensureWorkingDirectory(base, "feat/my branch!@#$");

      expect(result).toBe(resolve(base, "feat_my_branch____"));
      expect(existsSync(result)).toBe(true);
    });

    it("does not recreate or log when the directory already exists", () => {
      const base = makeTempDir();
      const logger = buildLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(base, "branch-a");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(base, "branch-a");

      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it does not yet exist", () => {
      const base = makeTempDir();
      const nested = join(base, "nested", "repo-root");
      const logger = buildLogger();
      const runner = new RepoRunner(logger as never);

      const result = runner.resolveRepoPath(nested);

      expect(result).toBe(resolve(nested));
      expect(existsSync(nested)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolve(nested) }, "Created repo base path");
    });

    it("does not recreate or log when the path already exists", () => {
      const base = makeTempDir();
      const logger = buildLogger();
      const runner = new RepoRunner(logger as never);

      const result = runner.resolveRepoPath(base);

      expect(result).toBe(resolve(base));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
