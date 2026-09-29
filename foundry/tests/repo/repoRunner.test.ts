import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: fsMocks.existsSync,
  mkdirSync: fsMocks.mkdirSync,
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("RepoRunner", () => {
  let logger: Logger;
  let runner: RepoRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    runner = new RepoRunner(logger);
  });

  describe("ensureWorkingDirectory", () => {
    it("sanitizes the branch name and returns the resolved directory when it already exists", () => {
      fsMocks.existsSync.mockReturnValue(true);

      const dir = runner.ensureWorkingDirectory("/base", "feature/ABC-123");

      expect(dir).toBe("/base/feature_ABC-123");
      expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory recursively and logs when it does not exist", () => {
      fsMocks.existsSync.mockReturnValue(false);

      const dir = runner.ensureWorkingDirectory("/base", "feature/x y");

      expect(dir).toBe("/base/feature_x_y");
      expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/base/feature_x_y", { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir: "/base/feature_x_y" }, "Created working directory");
    });
  });

  describe("resolveRepoPath", () => {
    it("returns the resolved base path without creating it when it already exists", () => {
      fsMocks.existsSync.mockReturnValue(true);

      const dir = runner.resolveRepoPath("/base/repo");

      expect(dir).toBe("/base/repo");
      expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
    });

    it("creates the base path recursively and logs when it does not exist", () => {
      fsMocks.existsSync.mockReturnValue(false);

      const dir = runner.resolveRepoPath("/base/repo");

      expect(dir).toBe("/base/repo");
      expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/base/repo", { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir: "/base/repo" }, "Created repo base path");
    });
  });
});
