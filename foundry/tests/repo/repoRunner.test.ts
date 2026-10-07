import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const existsSync = vi.fn();
const mkdirSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
}));

import { RepoRunner } from "../../src/repo/repoRunner.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RepoRunner.ensureWorkingDirectory", () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
  });

  it("creates the directory and logs when it does not already exist", () => {
    existsSync.mockReturnValue(false);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "my-branch");

    expect(dir).toBe(resolve("/base", "my-branch"));
    expect(mkdirSync).toHaveBeenCalledWith(resolve("/base", "my-branch"), { recursive: true });
    expect(logger.info).toHaveBeenCalledWith(
      { dir: resolve("/base", "my-branch") },
      "Created working directory",
    );
  });

  it("does not create the directory or log when it already exists", () => {
    existsSync.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.ensureWorkingDirectory("/base", "my-branch");

    expect(dir).toBe(resolve("/base", "my-branch"));
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("sanitizes characters outside [a-zA-Z0-9_-] in the branch name", () => {
    existsSync.mockReturnValue(true);
    const runner = new RepoRunner(makeLogger() as never);

    const dir = runner.ensureWorkingDirectory("/base", "feature/ABC-123 fix");

    expect(dir).toBe(resolve("/base", "feature_ABC-123_fix"));
  });
});

describe("RepoRunner.resolveRepoPath", () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
  });

  it("creates the base path and logs when it does not already exist", () => {
    existsSync.mockReturnValue(false);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("./workspace");

    expect(dir).toBe(resolve("./workspace"));
    expect(mkdirSync).toHaveBeenCalledWith(resolve("./workspace"), { recursive: true });
    expect(logger.info).toHaveBeenCalledWith(
      { dir: resolve("./workspace") },
      "Created repo base path",
    );
  });

  it("does not create the base path or log when it already exists", () => {
    existsSync.mockReturnValue(true);
    const logger = makeLogger();
    const runner = new RepoRunner(logger as never);

    const dir = runner.resolveRepoPath("./workspace");

    expect(dir).toBe(resolve("./workspace"));
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
