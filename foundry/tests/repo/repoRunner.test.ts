import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("RepoRunner", () => {
  let baseDir: string;
  let runner: RepoRunner;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "reporunner-test-"));
    runner = new RepoRunner(makeLogger());
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature-branch");
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature-branch"));
    });

    it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feat/foo bar@baz");
      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feat_foo_bar_baz"));
    });

    it("is idempotent when the directory already exists", () => {
      const first = runner.ensureWorkingDirectory(baseDir, "again");
      const second = runner.ensureWorkingDirectory(baseDir, "again");
      expect(second).toBe(first);
      expect(existsSync(second)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist and returns its resolved path", () => {
      const target = join(baseDir, "nested", "repo-root");
      expect(existsSync(target)).toBe(false);

      const result = runner.resolveRepoPath(target);

      expect(result).toBe(target);
      expect(existsSync(target)).toBe(true);
    });

    it("returns the resolved path without error when it already exists", () => {
      const result = runner.resolveRepoPath(baseDir);
      expect(result).toBe(baseDir);
      expect(existsSync(baseDir)).toBe(true);
    });
  });
});
