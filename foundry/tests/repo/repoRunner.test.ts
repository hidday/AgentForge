import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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

    it("sanitizes branch names by replacing non-alphanumeric characters with underscores", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(tmpRoot, "feat/foo bar@baz#123");

      expect(dir).toBe(join(tmpRoot, "feat_foo_bar_baz_123"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-create or re-log when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(tmpRoot, "same-branch");
      expect(logger.info).toHaveBeenCalledTimes(1);

      const second = runner.ensureWorkingDirectory(tmpRoot, "same-branch");
      expect(second).toBe(first);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("preserves allowed characters (alphanumeric, underscore, hyphen) unchanged", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(tmpRoot, "ai-lin-123_test");

      expect(dir).toBe(join(tmpRoot, "ai-lin-123_test"));
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const basePath = join(tmpRoot, "nested", "repo-base");

      const dir = runner.resolveRepoPath(basePath);

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(basePath));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not re-create or re-log when the base path already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.resolveRepoPath(tmpRoot);
      expect(logger.info).not.toHaveBeenCalled();

      const second = runner.resolveRepoPath(tmpRoot);
      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("resolves a relative path to an absolute path", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath(tmpRoot);

      expect(dir.startsWith("/")).toBe(true);
    });
  });
});
