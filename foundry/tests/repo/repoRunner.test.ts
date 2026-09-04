import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dir }),
        "Created working directory",
      );
    });

    it("sanitizes branch names, replacing disallowed characters with underscores", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/foo:bar baz");

      expect(dir).toBe(join(base, "feature_foo_bar_baz"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not re-log or fail when the directory already exists", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const first = runner.ensureWorkingDirectory(base, "same-branch");
      logger.info.mockClear();
      const second = runner.ensureWorkingDirectory(base, "same-branch");

      expect(second).toBe(first);
      expect(existsSync(second)).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the repo base path when missing and logs it", () => {
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);
      const target = join(base, "nested", "repo-base");

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(target);
      expect(existsSync(dir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dir }),
        "Created repo base path",
      );
    });

    it("does not log when the repo base path already exists", () => {
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
