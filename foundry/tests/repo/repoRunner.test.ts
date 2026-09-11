import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  const calls: { dir?: unknown; message: string }[] = [];
  return {
    logger: {
      info: (payload: unknown, message: string) => {
        calls.push({ dir: (payload as { dir?: unknown })?.dir, message });
      },
      warn: () => {},
      error: () => {},
      debug: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    calls,
  };
}

describe("RepoRunner", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory (recursively) when it does not exist and logs it", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/nested-branch");

      expect(existsSync(dir)).toBe(true);
      expect(calls.some((c) => c.message === "Created working directory")).toBe(true);
    });

    it("sanitizes non-alphanumeric characters in the branch name for the directory name", () => {
      const { logger } = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my branch!@#");

      expect(dir).toBe(join(baseDir, "feature_my_branch___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not error and does not re-log when the directory already exists", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(baseDir, "same-branch");
      calls.length = 0;
      const second = runner.ensureWorkingDirectory(baseDir, "same-branch");

      expect(second).toBe(first);
      expect(calls.some((c) => c.message === "Created working directory")).toBe(false);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path (recursively) when it does not exist and logs it", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);
      const target = join(baseDir, "nested", "repo-base");

      const resolved = runner.resolveRepoPath(target);

      expect(resolved).toBe(target);
      expect(existsSync(target)).toBe(true);
      expect(calls.some((c) => c.message === "Created repo base path")).toBe(true);
    });

    it("does not error and does not re-log when the path already exists", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath(baseDir);
      calls.length = 0;
      const resolved = runner.resolveRepoPath(baseDir);

      expect(resolved).toBe(baseDir);
      expect(calls.some((c) => c.message === "Created repo base path")).toBe(false);
    });
  });
});
