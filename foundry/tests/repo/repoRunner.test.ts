import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const dir = runner.ensureWorkingDirectory(tmpRoot, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(tmpRoot, "feature_my-branch"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const dir = runner.ensureWorkingDirectory(tmpRoot, "alice/eng#42!fix");

      expect(dir).toBe(join(tmpRoot, "alice_eng_42_fix"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not recreate or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const first = runner.ensureWorkingDirectory(tmpRoot, "feature-x");
      logger.info.mockClear();

      const second = runner.ensureWorkingDirectory(tmpRoot, "feature-x");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const basePath = join(tmpRoot, "nested", "repo-base");

      const resolved = runner.resolveRepoPath(basePath);

      expect(existsSync(resolved)).toBe(true);
      expect(resolved).toBe(basePath);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolved }, "Created repo base path");
    });

    it("does not re-create or re-log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      mkdirSync(join(tmpRoot, "already-there"));

      const resolved = runner.resolveRepoPath(join(tmpRoot, "already-there"));

      expect(existsSync(resolved)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
