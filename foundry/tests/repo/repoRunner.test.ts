import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
}));

const { RepoRunner } = await import("../../src/repo/repoRunner.js");

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  it("sanitizes non alphanumeric characters in the branch name into underscores", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feature/foo bar.baz");

    expect(dir).toBe(resolve("/base", "feature_foo_bar_baz"));
  });

  it("creates the directory and logs when it does not already exist", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "ai/lin-1");

    expect(mkdirSyncMock).toHaveBeenCalledWith(dir, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created working directory");
  });

  it("does not create the directory or log when it already exists", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    runner.ensureWorkingDirectory("/base", "ai/lin-1");

    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  it("resolves the given base path", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("./workspace");

    expect(dir).toBe(resolve("./workspace"));
  });

  it("creates the directory and logs 'Created repo base path' when it does not exist", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("./workspace");

    expect(mkdirSyncMock).toHaveBeenCalledWith(dir, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir }, "Created repo base path");
  });

  it("does not create the directory or log when it already exists", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    runner.resolveRepoPath("./workspace");

    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
