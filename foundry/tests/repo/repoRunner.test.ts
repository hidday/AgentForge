import { describe, it, expect, vi, beforeEach } from "vitest";

const existsSync = vi.fn();
const mkdirSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { info: vi.fn() } as unknown as Logger;
}

describe("RepoRunner", () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory and logs when it does not exist", () => {
      existsSync.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory("/base", "feature/my-branch");

      expect(dir).toContain("feature_my-branch");
      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does not create the directory or log when it already exists", () => {
      existsSync.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.ensureWorkingDirectory("/base", "feature/x");

      expect(mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("sanitizes branch names that contain path-unsafe characters", () => {
      existsSync.mockReturnValue(true);
      const runner = new RepoRunner(makeLogger());

      const dir = runner.ensureWorkingDirectory("/base", "feat/weird branch:name*?");

      expect(dir).not.toMatch(/[^\w\\/:-]/);
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the repo base path and logs when it does not exist", () => {
      existsSync.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.resolveRepoPath("/base/repo");

      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("does not create the path or log when it already exists", () => {
      existsSync.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath("/base/repo");

      expect(mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
