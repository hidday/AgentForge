import { describe, it, expect, vi, beforeEach } from "vitest";

// These two branches in validateWorkingDirectory are only reachable via
// filesystem states that are impractical (or impossible) to create for real
// (a special file that is neither a directory nor a regular file at .git, and
// a working directory that fails an isDirectory() check despite having
// already passed an existsSync() check for a nested .git path). We simulate
// them by mocking node:fs's statSync while keeping everything else real.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    statSync: vi.fn(actual.statSync),
  };
});

import { existsSync, statSync } from "node:fs";
import { RepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(): ReposConfig {
  return {
    defaultRepo: "backend",
    repos: [
      {
        name: "backend",
        directory: "backend",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
  };
}

describe("RepoRegistry.validateWorkingDirectory - fs edge cases", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(statSync).mockReset();
  });

  it("throws when the .git entry exists but is neither a directory nor a regular file", () => {
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => false,
    } as unknown as ReturnType<typeof statSync>);

    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);

    expect(() => registry.validateWorkingDirectory("/fake/repo")).toThrow(
      /invalid \.git entry/,
    );
  });

  it("throws when the working directory path itself fails the final isDirectory() check", () => {
    vi.mocked(statSync)
      .mockReturnValueOnce({ isDirectory: () => true, isFile: () => false } as unknown as ReturnType<
        typeof statSync
      >) // gitDir stat: looks like a normal clone
      .mockReturnValueOnce({ isDirectory: () => false } as unknown as ReturnType<typeof statSync>); // workingDirectory stat

    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);

    expect(() => registry.validateWorkingDirectory("/fake/repo")).toThrow(
      /path is not a directory/,
    );
  });
});
