import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
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
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  function makeBase(): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
    tempDirs.push(dir);
    return dir;
  }

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const base = makeBase();
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "ai/lin-123");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes unsafe characters in the branch name", () => {
      const base = makeBase();
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/foo bar!@#");

      expect(dir).not.toContain("/foo bar!@#");
      expect(dir.endsWith("feature_foo_bar___")).toBe(true);
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-create or re-log when the directory already exists", () => {
      const base = makeBase();
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(base, "ai/lin-123");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(base, "ai/lin-123");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const base = makeBase();
      const target = join(base, "nested", "repo-root");
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(target);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not re-create or re-log when the path already exists", () => {
      const base = makeBase();
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.resolveRepoPath(base);
      logger.info.mockClear();
      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(base);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
