import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { info: vi.fn() } as unknown as Logger;
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
    it("creates the directory and logs when it doesn't exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "feature_my-branch"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(base, "feat/weird name!@#");

      expect(dir).toBe(join(base, "feat_weird_name___"));
    });

    it("does not log or re-create the directory when it already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(base, "my-branch");
      vi.mocked(logger.info).mockClear();
      const second = runner.ensureWorkingDirectory(base, "my-branch");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path and logs when it doesn't exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const target = join(base, "nested", "repo-base");

      const dir = runner.resolveRepoPath(target);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(target);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not log or re-create the path when it already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.resolveRepoPath(base);
      vi.mocked(logger.info).mockClear();
      const second = runner.resolveRepoPath(base);

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
