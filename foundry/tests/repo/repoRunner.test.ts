import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  const calls: { level: string; args: unknown[] }[] = [];
  return {
    logger: {
      info: (...args: unknown[]) => calls.push({ level: "info", args }),
      warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
      error: (...args: unknown[]) => calls.push({ level: "error", args }),
      debug: (...args: unknown[]) => calls.push({ level: "debug", args }),
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
    it("creates the directory when it does not exist and logs it", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/add-x");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature_add-x"));
      expect(calls.some((c) => c.level === "info")).toBe(true);
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const { logger } = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory(baseDir, "hidday/PRY-42: fix bug!");

      expect(dir).toBe(join(baseDir, "hidday_PRY-42__fix_bug_"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not log or fail when the directory already exists", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);

      const first = runner.ensureWorkingDirectory(baseDir, "branch-a");
      calls.length = 0;
      const second = runner.ensureWorkingDirectory(baseDir, "branch-a");

      expect(second).toBe(first);
      expect(calls.some((c) => c.level === "info")).toBe(false);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);
      const newBase = join(baseDir, "nested", "repo-base");

      const resolved = runner.resolveRepoPath(newBase);

      expect(resolved).toBe(newBase);
      expect(existsSync(newBase)).toBe(true);
      expect(calls.some((c) => c.level === "info")).toBe(true);
    });

    it("does not log when the path already exists", () => {
      const { logger, calls } = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath(baseDir);
      calls.length = 0;
      const resolved = runner.resolveRepoPath(baseDir);

      expect(resolved).toBe(baseDir);
      expect(calls.some((c) => c.level === "info")).toBe(false);
    });

    it("resolves a relative path against process.cwd()", () => {
      const { logger } = makeLogger();
      const runner = new RepoRunner(logger);
      const resolved = runner.resolveRepoPath(".");
      expect(resolved).toBe(process.cwd());
    });
  });
});
