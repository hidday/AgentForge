import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    it("creates the directory (sanitizing the branch name) when it does not exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my branch!");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "feature_my_branch_"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not recreate or log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(base, "ai/run-1");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(base, "ai/run-1");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const target = join(base, "nested", "repo");

      const dir = runner.resolveRepoPath(target);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(target);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.resolveRepoPath(base);

      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
