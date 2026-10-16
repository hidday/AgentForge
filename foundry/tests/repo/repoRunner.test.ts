import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const { existsSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe("RepoRunner", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  describe("ensureWorkingDirectory", () => {
    it("does not create the directory or log when it already exists", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "feature-branch");

      expect(result).toBe(resolve("/base", "feature-branch"));
      expect(mkdirSyncMock).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory and logs when it does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "feature-branch");
      const expectedDir = resolve("/base", "feature-branch");

      expect(result).toBe(expectedDir);
      expect(mkdirSyncMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir: expectedDir }, "Created working directory");
    });

    it("sanitizes a branch name containing slashes and special characters", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "feat/LIN-123: add thing!");
      const expectedDir = resolve("/base", "feat_LIN-123__add_thing_");

      expect(result).toBe(expectedDir);
      expect(mkdirSyncMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
    });
  });

  describe("resolveRepoPath", () => {
    it("does not create the directory or log when it already exists", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.resolveRepoPath("/base/repo");

      expect(result).toBe(resolve("/base/repo"));
      expect(mkdirSyncMock).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory and logs when it does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.resolveRepoPath("/base/repo");
      const expectedDir = resolve("/base/repo");

      expect(result).toBe(expectedDir);
      expect(mkdirSyncMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir: expectedDir }, "Created repo base path");
    });
  });
});
