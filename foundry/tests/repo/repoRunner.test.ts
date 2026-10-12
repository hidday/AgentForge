import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { info: vi.fn() } as unknown as Logger;
}

describe("RepoRunner", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and sanitizes the branch name when it does not exist", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      tempDirs.push(base);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch!!");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "feature_my-branch__"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not recreate or log when the directory already exists", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      tempDirs.push(base);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(base, "main");
      vi.mocked(logger.info).mockClear();
      const second = runner.ensureWorkingDirectory(base, "main");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the repo base path when it does not exist", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      tempDirs.push(base);
      const target = join(base, "nested", "repo");
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.resolveRepoPath(target);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(target);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not recreate or log when the repo path already exists", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      tempDirs.push(base);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath(base);
      vi.mocked(logger.info).mockClear();
      const second = runner.resolveRepoPath(base);

      expect(second).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
