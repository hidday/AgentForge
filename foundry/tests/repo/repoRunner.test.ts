import { describe, it, expect, vi, beforeEach } from "vitest";

const { existsSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
}));

import { resolve } from "node:path";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureWorkingDirectory", () => {
    it("creates the directory when it does not exist, sanitizing the branch name", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.ensureWorkingDirectory("/base", "feature/add login!");

      const expected = resolve("/base", "feature_add_login_");
      expect(dir).toBe(expected);
      expect(mkdirSyncMock).toHaveBeenCalledWith(expected, { recursive: true });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not create the directory when it already exists", () => {
      existsSyncMock.mockReturnValue(true);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      runner.ensureWorkingDirectory("/base", "feature-1");

      expect(mkdirSyncMock).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("leaves alphanumeric, dash, and underscore characters in the branch name untouched", () => {
      existsSyncMock.mockReturnValue(true);
      const runner = new RepoRunner(makeLogger() as never);

      const dir = runner.ensureWorkingDirectory("/base", "ai_feature-123");

      expect(dir).toBe(resolve("/base", "ai_feature-123"));
    });
  });

  describe("resolveRepoPath", () => {
    it("creates the base path when it does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const runner = new RepoRunner(logger as never);

      const dir = runner.resolveRepoPath("/repos/acme");

      expect(dir).toBe(resolve("/repos/acme"));
      expect(mkdirSyncMock).toHaveBeenCalledWith(resolve("/repos/acme"), { recursive: true });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not create the base path when it already exists", () => {
      existsSyncMock.mockReturnValue(true);
      const runner = new RepoRunner(makeLogger() as never);

      runner.resolveRepoPath("/repos/acme");

      expect(mkdirSyncMock).not.toHaveBeenCalled();
    });
  });
});
