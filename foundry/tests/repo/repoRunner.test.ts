import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RepoRunner", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it does not yet exist", () => {
      const logger = makeMockLogger();
      const runner = new RepoRunner(logger as never);
      dir = join(tmpdir(), `repo-runner-ensure-${Date.now()}`);
      const branchDir = join(dir, "feature-x");

      const result = runner.ensureWorkingDirectory(dir, "feature-x");

      expect(result).toBe(branchDir);
      expect(existsSync(branchDir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: branchDir }, "Created working directory");
    });

    it("does not recreate or log when the directory already exists", () => {
      const logger = makeMockLogger();
      const runner = new RepoRunner(logger as never);
      dir = join(tmpdir(), `repo-runner-existing-${Date.now()}`);
      const branchDir = join(dir, "feature-x");
      mkdirSync(branchDir, { recursive: true });

      const result = runner.ensureWorkingDirectory(dir, "feature-x");

      expect(result).toBe(branchDir);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("sanitizes special characters in the branch name into underscores", () => {
      const logger = makeMockLogger();
      const runner = new RepoRunner(logger as never);
      dir = join(tmpdir(), `repo-runner-sanitize-${Date.now()}`);

      const result = runner.ensureWorkingDirectory(dir, "feature/foo bar!@#");

      expect(result).toBe(join(dir, "feature_foo_bar___"));
      expect(existsSync(result)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it does not yet exist", () => {
      const logger = makeMockLogger();
      const runner = new RepoRunner(logger as never);
      dir = join(tmpdir(), `repo-runner-base-${Date.now()}`);

      const result = runner.resolveRepoPath(dir);

      expect(result).toBe(dir);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not recreate or log when the base path already exists", () => {
      const logger = makeMockLogger();
      const runner = new RepoRunner(logger as never);
      dir = join(tmpdir(), `repo-runner-base-existing-${Date.now()}`);
      mkdirSync(dir, { recursive: true });

      const result = runner.resolveRepoPath(dir);

      expect(result).toBe(dir);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
