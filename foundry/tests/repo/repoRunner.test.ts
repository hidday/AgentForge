import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: fsMocks.existsSync,
  mkdirSync: fsMocks.mkdirSync,
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureWorkingDirectory", () => {
    it("sanitizes the branch name and resolves it under basePath", () => {
      fsMocks.existsSync.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory("/base", "feature/add login!");

      expect(dir).toBe(resolve("/base", "feature_add_login_"));
      expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory recursively and logs when it does not already exist", () => {
      fsMocks.existsSync.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory("/base", "ai/lin-1");

      expect(fsMocks.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });
  });

  describe("resolveRepoPath", () => {
    it("returns the resolved base path without creating it when it already exists", () => {
      fsMocks.existsSync.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath("/some/base");

      expect(dir).toBe(resolve("/some/base"));
      expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
    });

    it("creates the base path recursively and logs when it does not exist", () => {
      fsMocks.existsSync.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath("/some/base");

      expect(fsMocks.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });
  });
});
