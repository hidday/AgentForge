import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

describe("RepoRunner", () => {
  let base: string;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  let runner: RepoRunner;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and sanitizes the branch name", () => {
      const dir = runner.ensureWorkingDirectory(base, "feature/my branch!");
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "feature_my_branch_"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not log or re-create when the directory already exists", () => {
      const dir = runner.ensureWorkingDirectory(base, "ai/run-1");
      logger.info.mockClear();
      const dirAgain = runner.ensureWorkingDirectory(base, "ai/run-1");
      expect(dirAgain).toBe(dir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      const nested = join(base, "nested", "repo");
      const dir = runner.resolveRepoPath(nested);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not log when the path already exists", () => {
      runner.resolveRepoPath(base);
      logger.info.mockClear();
      const dir = runner.resolveRepoPath(base);
      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
