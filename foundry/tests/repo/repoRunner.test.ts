import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
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
    it("creates the directory and sanitizes unsafe characters in the branch name", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(tmpRoot, "feature/my branch!@#");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(tmpRoot, "feature_my_branch___"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not log or re-create the directory when it already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(tmpRoot, "ai/run-1");
      expect(logger.info).toHaveBeenCalledTimes(1);

      logger.info = vi.fn();
      const second = runner.ensureWorkingDirectory(tmpRoot, "ai/run-1");

      expect(second).toBe(first);
      expect(existsSync(second)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("preserves allowed characters (letters, digits, dash, underscore)", () => {
      const runner = new RepoRunner(makeLogger());
      const dir = runner.ensureWorkingDirectory(tmpRoot, "Valid-Branch_123");
      expect(dir).toBe(join(tmpRoot, "Valid-Branch_123"));
    });
  });

  describe("resolveRepoPath", () => {
    it("resolves and creates the base path when it does not exist", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);
      const target = join(tmpRoot, "nested", "repo-base");

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(target);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: target }, "Created repo base path");
    });

    it("does not log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath(tmpRoot);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it("returns an absolute, resolved path for a relative input", () => {
      const runner = new RepoRunner(makeLogger());
      const dir = runner.resolveRepoPath(".");
      expect(dir).toBe(resolveCwd());
    });
  });
});

function resolveCwd(): string {
  // Mirrors `resolve(".")` semantics without importing `resolve` twice.
  return process.cwd();
}
