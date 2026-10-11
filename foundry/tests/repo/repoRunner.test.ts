import { describe, it, expect, vi, beforeEach } from "vitest";

const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";
import { resolve } from "node:path";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
  });

  it("creates the directory and logs when it does not exist", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feature/foo-bar");

    const expected = resolve("/base", "feature_foo-bar");
    expect(dir).toBe(expected);
    expect(mkdirSyncMock).toHaveBeenCalledWith(expected, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created working directory");
  });

  it("sanitizes branch names containing disallowed characters", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feat/ISSUE-123: fix it!");

    expect(dir).toBe(resolve("/base", "feat_ISSUE-123__fix_it_"));
  });

  it("does not create the directory or log when it already exists", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeLogger();
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
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("/some/base");

    const expected = resolve("/some/base");
    expect(dir).toBe(expected);
    expect(mkdirSyncMock).toHaveBeenCalledWith(expected, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created repo base path");
  });

  it("does not create the base path when it already exists", () => {
    existsSyncMock.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("/some/base");

    expect(dir).toBe(resolve("/some/base"));
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
