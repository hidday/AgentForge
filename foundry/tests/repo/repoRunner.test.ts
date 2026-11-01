import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  it("sanitizes the branch name and creates the directory when missing", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feature/ABC-123 fix!");

    const expected = resolve("/base", "feature_ABC-123_fix_");
    expect(dir).toBe(expected);
    expect(mkdirSyncMock).toHaveBeenCalledWith(expected, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created working directory");
  });

  it("does not create the directory or log when it already exists", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "main");

    expect(dir).toBe(resolve("/base", "main"));
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  it("creates the base path and logs when it does not exist", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("/workspace/repo");

    const expected = resolve("/workspace/repo");
    expect(dir).toBe(expected);
    expect(mkdirSyncMock).toHaveBeenCalledWith(expected, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created repo base path");
  });

  it("returns the resolved path without creating anything when it already exists", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("/workspace/repo");

    expect(dir).toBe(resolve("/workspace/repo"));
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
