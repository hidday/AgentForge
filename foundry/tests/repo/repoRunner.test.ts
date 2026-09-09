import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let base: string;

  afterEach(() => {
    if (base && existsSync(base)) {
      rmSync(base, { recursive: true, force: true });
    }
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "ai/lin-1");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "ai_lin-1"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const runner = new RepoRunner(makeLogger() as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/foo bar!.baz");

      expect(dir).toBe(join(base, "feature_foo_bar__baz"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-log or fail when the directory already exists", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.ensureWorkingDirectory(base, "ai/lin-1");
      logger.info.mockClear();
      const dir = runner.ensureWorkingDirectory(base, "ai/lin-1");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and logs it", () => {
      base = join(mkdtempSync(join(tmpdir(), "repo-runner-test-")), "nested", "repo");
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const resolved = runner.resolveRepoPath(base);

      expect(existsSync(resolved)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir: resolved }, "Created repo base path");
    });

    it("returns the resolved absolute path without creating anything when it already exists", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const resolved = runner.resolveRepoPath(base);

      expect(resolved).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
