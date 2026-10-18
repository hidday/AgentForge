import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let basePath: string;
  let logger: ReturnType<typeof makeMockLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), "reporunner-test-"));
    logger = makeMockLogger();
    runner = new RepoRunner(logger as unknown as Logger);
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const dir = runner.ensureWorkingDirectory(basePath, "feature-x");
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(basePath, "feature-x"));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(basePath, "feature/foo bar!@#");
      expect(dir).toBe(join(basePath, "feature_foo_bar___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-create or re-log when the directory already exists", () => {
      const first = runner.ensureWorkingDirectory(basePath, "feature-y");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(basePath, "feature-y");
      expect(second).toBe(first);
      // No additional log call since the directory already existed on the second call.
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("supports nested branch creation under the same base path independently", () => {
      const dirA = runner.ensureWorkingDirectory(basePath, "branch-a");
      const dirB = runner.ensureWorkingDirectory(basePath, "branch-b");
      expect(dirA).not.toBe(dirB);
      expect(existsSync(dirA)).toBe(true);
      expect(existsSync(dirB)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const nested = join(basePath, "nested", "repo-root");
      const dir = runner.resolveRepoPath(nested);
      expect(dir).toBe(nested);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not re-create or re-log when the path already exists", () => {
      runner.resolveRepoPath(basePath);
      // basePath already existed (created by mkdtempSync), so no creation log at all.
      expect(logger.info).not.toHaveBeenCalled();

      runner.resolveRepoPath(basePath);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("resolves a relative-looking path to an absolute path", () => {
      const dir = runner.resolveRepoPath(basePath);
      expect(dir.startsWith("/")).toBe(true);
    });
  });
});
