import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, mkdirSync } from "node:fs";
import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { info: vi.fn() } as unknown as Logger;
}

describe("RepoRunner", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
  });

  describe("ensureWorkingDirectory", () => {
    it("creates and logs the directory when missing, sanitizing the branch name", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.ensureWorkingDirectory("/base", "feature/foo bar!");

      expect(dir.endsWith("feature_foo_bar_")).toBe(true);
      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
    });

    it("does nothing when the directory already exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.ensureWorkingDirectory("/base", "main");

      expect(mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("resolveRepoPath", () => {
    it("creates and logs the base path when missing", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const dir = runner.resolveRepoPath("/base");

      expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
    });

    it("leaves an existing base path alone", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      runner.resolveRepoPath("/base");

      expect(mkdirSync).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
