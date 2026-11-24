import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
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
  let baseDir: string;

  afterEach(() => {
    if (baseDir && existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist, sanitizing the branch name", () => {
      baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const runner = new RepoRunner(noopLogger);

      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my branch!");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature_my_branch_"));
    });

    it("is idempotent when the directory already exists", () => {
      baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const runner = new RepoRunner(noopLogger);

      const first = runner.ensureWorkingDirectory(baseDir, "feature");
      const second = runner.ensureWorkingDirectory(baseDir, "feature");

      expect(first).toBe(second);
      expect(existsSync(second)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path if missing and returns the resolved absolute path", () => {
      const parent = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      baseDir = parent;
      const nested = join(parent, "nested", "repo");
      const runner = new RepoRunner(noopLogger);

      const dir = runner.resolveRepoPath(nested);

      expect(dir).toBe(nested);
      expect(existsSync(dir)).toBe(true);
    });

    it("returns the resolved path as-is when it already exists", () => {
      baseDir = mkdtempSync(join(tmpdir(), "repo-runner-test-"));
      const runner = new RepoRunner(noopLogger);

      const dir = runner.resolveRepoPath(baseDir);

      expect(dir).toBe(baseDir);
    });
  });
});
