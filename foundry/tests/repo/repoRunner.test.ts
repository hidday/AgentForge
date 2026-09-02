import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  let baseDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let runner: RepoRunner;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "reporunner-test-"));
    logger = makeLogger();
    runner = new RepoRunner(logger as never);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist and logs creation", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "feature/my-branch");

      expect(existsSync(dir)).toBe(true);
      expect(dir).toBe(join(baseDir, "feature_my-branch"));
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("sanitizes non-alphanumeric characters in the branch name", () => {
      const dir = runner.ensureWorkingDirectory(baseDir, "hidday/PRY-42: fix!!");

      expect(dir).toBe(join(baseDir, "hidday_PRY-42__fix__"));
      expect(existsSync(dir)).toBe(true);
    });

    it("does not error and does not re-log when the directory already exists", () => {
      const first = runner.ensureWorkingDirectory(baseDir, "same-branch");
      logger.info.mockClear();

      const second = runner.ensureWorkingDirectory(baseDir, "same-branch");

      expect(second).toBe(first);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates nested directories recursively", () => {
      const nestedBase = join(baseDir, "not", "yet", "created");
      const dir = runner.ensureWorkingDirectory(nestedBase, "branch");
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("returns the resolved absolute path for an existing directory without creating/logging", () => {
      const existing = join(baseDir, "already-here");
      mkdirSync(existing);

      const resolved = runner.resolveRepoPath(existing);

      expect(resolved).toBe(existing);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory and logs when it does not exist", () => {
      const target = join(baseDir, "brand-new");

      const resolved = runner.resolveRepoPath(target);

      expect(existsSync(target)).toBe(true);
      expect(resolved).toBe(target);
      expect(logger.info).toHaveBeenCalledWith({ dir: target }, "Created repo base path");
    });

    it("creates nested missing directories recursively", () => {
      const target = join(baseDir, "a", "b", "c");
      const resolved = runner.resolveRepoPath(target);
      expect(existsSync(target)).toBe(true);
      expect(resolved).toBe(target);
    });

    it("resolves relative paths to an absolute path", () => {
      const resolved = runner.resolveRepoPath(".");
      expect(resolved.startsWith("/")).toBe(true);
    });
  });
});
