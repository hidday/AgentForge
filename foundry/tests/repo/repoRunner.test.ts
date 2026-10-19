import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let base: string;
  let logger: ReturnType<typeof makeLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    logger = makeLogger();
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const dir = runner.ensureWorkingDirectory(base, "ai/issue-1");
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "ai_issue-1"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(base, "feature/foo bar!@#");
      expect(dir).toBe(join(base, "feature_foo_bar___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("is idempotent and does not re-log when the directory already exists", () => {
      runner.ensureWorkingDirectory(base, "ai/issue-1");
      logger.info.mockClear();
      const dir = runner.ensureWorkingDirectory(base, "ai/issue-1");
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const newBase = join(base, "nested", "repo-base");
      const dir = runner.resolveRepoPath(newBase);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not re-log when the path already exists", () => {
      runner.resolveRepoPath(base);
      logger.info.mockClear();
      const dir = runner.resolveRepoPath(base);
      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
