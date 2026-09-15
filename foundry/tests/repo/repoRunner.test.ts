import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("RepoRunner", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  describe("ensureWorkingDirectory", () => {
    it("does not create the directory when it already exists", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "feature-branch");

      expect(result).toContain("feature-branch");
      expect(mkdirSyncMock).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory and logs when it does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "feature-branch");

      expect(mkdirSyncMock).toHaveBeenCalledWith(result, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir: result }, "Created working directory");
    });

    it("sanitizes invalid characters in the branch name", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "feature/foo bar!@#");

      expect(result).toContain("feature_foo_bar___");
      const basename = result.slice(result.lastIndexOf("/") + 1);
      expect(basename).not.toMatch(/[ !@#]/);
    });

    it("leaves valid characters (letters, digits, _ and -) untouched", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.ensureWorkingDirectory("/base", "abc-123_XYZ");

      expect(result.endsWith("abc-123_XYZ")).toBe(true);
    });
  });

  describe("resolveRepoPath", () => {
    it("does not create the directory when it already exists", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.resolveRepoPath("/some/base");

      expect(result).toBe(resolve("/some/base"));
      expect(mkdirSyncMock).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("creates the directory and logs when it does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger);

      const result = runner.resolveRepoPath("/some/base");

      expect(mkdirSyncMock).toHaveBeenCalledWith(result, { recursive: true });
      expect(logger.info).toHaveBeenCalledWith({ dir: result }, "Created repo base path");
    });
  });
});
