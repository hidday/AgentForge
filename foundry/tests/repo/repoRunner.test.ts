import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
  });

  describe("ensureWorkingDirectory", () => {
    it("returns the existing directory without creating it", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory("/base", "ai/issue-1");

      expect(dir).toBe(resolve("/base", "ai_issue-1"));
      expect(mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory recursively and logs when it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory("/base", "ai/issue-1");

      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalled();
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const runner = new RepoRunner(makeLogger() as never);

      const dir = runner.ensureWorkingDirectory("/base", "feature/PRY-1: fix bug!");

      expect(dir).toBe(resolve("/base", "feature_PRY-1__fix_bug_"));
    });
  });

  describe("resolveRepoPath", () => {
    it("returns the resolved path without creating it when it already exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath("/some/base");

      expect(dir).toBe(resolve("/some/base"));
      expect(mkdirSync).not.toHaveBeenCalled();
    });

    it("creates the base path recursively and logs when it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath("/some/base");

      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalled();
    });
  });
});
