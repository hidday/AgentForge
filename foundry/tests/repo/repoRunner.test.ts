import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, mkdirSync } from "node:fs";
import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
  });

  it("creates the directory and logs when it does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feature-branch");

    const expected = resolve("/base", "feature-branch");
    expect(dir).toBe(expected);
    expect(mkdirSync).toHaveBeenCalledWith(expected, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created working directory");
  });

  it("skips mkdir but still returns the resolved path when the directory exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feature-branch");

    const expected = resolve("/base", "feature-branch");
    expect(dir).toBe(expected);
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("sanitizes branch names, replacing characters outside [a-zA-Z0-9_-] with underscores", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "feat/ABC-123 fix!");

    const expected = resolve("/base", "feat_ABC-123_fix_");
    expect(dir).toBe(expected);
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
  });

  it("creates the repo base path and logs when it does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("/base/repos");

    const expected = resolve("/base/repos");
    expect(dir).toBe(expected);
    expect(mkdirSync).toHaveBeenCalledWith(expected, { recursive: true });
    expect(logger.info).toHaveBeenCalledWith({ dir: expected }, "Created repo base path");
  });

  it("skips mkdir but still returns the resolved path when the repo base path exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const logger = makeMockLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("/base/repos");

    const expected = resolve("/base/repos");
    expect(dir).toBe(expected);
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
