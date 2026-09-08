import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("RepoRunner", () => {
  let base: string;

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and returns its resolved path", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      const runner = new RepoRunner(noopLogger);

      const dir = runner.ensureWorkingDirectory(base, "ai/lin-1");

      expect(dir).toBe(resolve(base, "ai_lin-1"));
      expect(existsSync(dir)).toBe(true);
    });

    it("sanitizes disallowed characters out of the branch name", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      const runner = new RepoRunner(noopLogger);

      const dir = runner.ensureWorkingDirectory(base, "feature/foo bar!@#");

      expect(dir).toBe(resolve(base, "feature_foo_bar___"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not error when the directory already exists", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      const runner = new RepoRunner(noopLogger);

      const first = runner.ensureWorkingDirectory(base, "ai/lin-1");
      const second = runner.ensureWorkingDirectory(base, "ai/lin-1");

      expect(second).toBe(first);
      expect(existsSync(second)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when missing and returns its resolved form", () => {
      const parent = mkdtempSync(join(tmpdir(), "repo-runner-"));
      base = parent;
      const target = join(parent, "nested", "workspace");
      const runner = new RepoRunner(noopLogger);

      const dir = runner.resolveRepoPath(target);

      expect(dir).toBe(resolve(target));
      expect(existsSync(dir)).toBe(true);
    });

    it("returns the resolved path without error when it already exists", () => {
      base = mkdtempSync(join(tmpdir(), "repo-runner-"));
      const runner = new RepoRunner(noopLogger);

      const dir = runner.resolveRepoPath(base);

      expect(dir).toBe(resolve(base));
      expect(existsSync(dir)).toBe(true);
    });
  });
});
