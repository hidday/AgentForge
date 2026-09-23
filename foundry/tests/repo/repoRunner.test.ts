import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

describe("RepoRunner", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "reporunner-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory()", () => {
    it("creates the directory when it does not exist and logs it", () => {
      const calls: unknown[][] = [];
      const runner = new RepoRunner({
        info: (...args: unknown[]) => calls.push(args),
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(base, "feature_my-branch"));
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]).toBe("Created working directory");
    });

    it("does not recreate or re-log the directory when it already exists", () => {
      const calls: unknown[][] = [];
      const runner = new RepoRunner({
        info: (...args: unknown[]) => calls.push(args),
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as never);

      const dir1 = runner.ensureWorkingDirectory(base, "main");
      expect(calls).toHaveLength(1);

      const dir2 = runner.ensureWorkingDirectory(base, "main");
      expect(dir2).toBe(dir1);
      // No additional "Created working directory" log on the second call.
      expect(calls).toHaveLength(1);
    });

    it("sanitizes branch names, replacing non-alphanumeric characters with underscores", () => {
      const runner = new RepoRunner({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as never);

      const dir = runner.ensureWorkingDirectory(base, "feature/foo bar!@#123");
      expect(dir).toBe(join(base, "feature_foo_bar___123"));
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("resolveRepoPath()", () => {
    it("creates the base path when it does not exist and logs it", () => {
      const calls: unknown[][] = [];
      const runner = new RepoRunner({
        info: (...args: unknown[]) => calls.push(args),
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as never);

      const nested = join(base, "nested", "repo-root");
      const resolved = runner.resolveRepoPath(nested);

      expect(resolved).toBe(nested);
      expect(existsSync(nested)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]).toBe("Created repo base path");
    });

    it("does not recreate or re-log the path when it already exists", () => {
      const calls: unknown[][] = [];
      const runner = new RepoRunner({
        info: (...args: unknown[]) => calls.push(args),
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as never);

      runner.resolveRepoPath(base);
      expect(calls).toHaveLength(0);

      runner.resolveRepoPath(base);
      expect(calls).toHaveLength(0);
    });
  });
});
