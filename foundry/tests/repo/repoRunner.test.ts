import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("RepoRunner", () => {
  let baseDir: string;
  let runner: RepoRunner;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "reporunner-test-"));
    runner = new RepoRunner(noopLogger);
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates and returns a sanitized working directory path", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/add thing!");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature_add_thing_"));
      expect(noopLogger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not recreate or log again when the directory already exists", () => {
      const first = runner.ensureWorkingDirectory(baseDir, "feature/x");
      vi.clearAllMocks();

      const second = runner.ensureWorkingDirectory(baseDir, "feature/x");

      expect(second).toBe(first);
      expect(noopLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates and returns the base path if missing", () => {
      const nested = join(baseDir, "nested", "repo-root");

      const resolved = runner.resolveRepoPath(nested);

      expect(existsSync(nested)).toBe(true);
      expect(resolved).toBe(nested);
      expect(noopLogger.info).toHaveBeenCalledWith({ dir: nested }, "Created repo base path");
    });

    it("does not log when the base path already exists", () => {
      runner.resolveRepoPath(baseDir);
      vi.clearAllMocks();

      runner.resolveRepoPath(baseDir);

      expect(noopLogger.info).not.toHaveBeenCalled();
    });
  });
});
