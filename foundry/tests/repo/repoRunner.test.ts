import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  const dirsToClean: string[] = [];

  afterEach(() => {
    while (dirsToClean.length) {
      const dir = dirsToClean.pop();
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("ensureWorkingDirectory()", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      dirsToClean.push(base);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes unsafe branch-name characters into underscores", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      dirsToClean.push(base);
      const runner = new RepoRunner(makeLogger() as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my branch!@#");

      expect(dir).toBe(join(base, "feature_my_branch___"));
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      dirsToClean.push(base);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.ensureWorkingDirectory(base, "branch-a");
      logger.info.mockClear();
      const dir = runner.ensureWorkingDirectory(base, "branch-a");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath()", () => {
    it("creates the base path when missing and logs it", () => {
      const parent = mkdtempSync(join(tmpdir(), "repo-runner-"));
      dirsToClean.push(parent);
      const base = join(parent, "nested", "repo-base");
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath(base);

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("returns the resolved absolute path without recreating an existing directory", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      dirsToClean.push(base);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
