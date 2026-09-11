import { describe, it, expect, vi } from "vitest";

// validateWorkingDirectory's final `stat.isDirectory()` check guards against
// the working directory changing type (e.g. replaced by a non-directory)
// between the .git-entry check and the final directory check — a TOCTOU-style
// race that can't be reproduced with real filesystem calls in a unit test, so
// we mock node:fs to simulate it deterministically.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    statSync: vi
      .fn()
      // First statSync call is for the `.git` entry — report it as a valid directory.
      .mockReturnValueOnce({ isDirectory: () => true, isFile: () => false })
      // Second statSync call is for the working directory itself — report it as
      // no longer being a directory (e.g. replaced by a file).
      .mockReturnValueOnce({ isDirectory: () => false, isFile: () => true }),
  };
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  it("throws when the working directory path is no longer a directory at the final check", async () => {
    const { RepoRegistry } = await import("../../src/config/repoRegistry.js");
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const registry = new RepoRegistry(
      "/repos",
      {
        repos: [
          {
            name: "test-repo",
            directory: "test-repo",
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
        defaultRepo: "test-repo",
      },
      logger as never,
    );

    expect(() => registry.validateWorkingDirectory("/repos/test-repo")).toThrow(
      "Working directory path is not a directory: /repos/test-repo.",
    );
  });
});
