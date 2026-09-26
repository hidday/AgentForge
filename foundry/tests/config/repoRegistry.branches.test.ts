import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
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
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        defaultBranch: "main",
        allowedPaths: [],
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
    defaultRepo: "repo-a",
  };
}

describe("RepoRegistry.validateWorkingDirectory — fs-mocked edge cases", () => {
  it("throws when the .git entry exists but is neither a directory nor a file (e.g. a socket)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => false,
    } as unknown as ReturnType<typeof statSync>);

    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);

    expect(() => registry.validateWorkingDirectory("/fake/working-dir")).toThrow(
      /Working directory has invalid \.git entry/,
    );

    vi.mocked(existsSync).mockRestore();
    vi.mocked(statSync).mockRestore();
  });

  it("throws when workingDirectory itself is not a directory even though its .git entry is valid", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync)
      .mockReturnValueOnce({ isDirectory: () => true, isFile: () => false } as unknown as ReturnType<
        typeof statSync
      >) // gitDir stat: a normal .git directory
      .mockReturnValueOnce({ isDirectory: () => false, isFile: () => true } as unknown as ReturnType<
        typeof statSync
      >); // workingDirectory stat: not a directory

    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);

    expect(() => registry.validateWorkingDirectory("/fake/working-dir")).toThrow(
      /Working directory path is not a directory/,
    );

    vi.mocked(existsSync).mockRestore();
    vi.mocked(statSync).mockRestore();
  });
});
