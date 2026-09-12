import { describe, it, expect, vi } from "vitest";

// These two branches in validateWorkingDirectory are unreachable via a real
// filesystem in the "does not exist" / "is not a git repo" tests (see
// repoRegistry.test.ts): a workingDirectory that has a real ".git" child must
// itself behave like a directory, and a ".git" entry that exists is always
// either a real file or a real directory on every common OS. Mock node:fs to
// force those defensive branches directly.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    statSync: vi.fn(),
  };
});

describe("RepoRegistry.validateWorkingDirectory with a mocked filesystem", () => {
  it("throws when the .git entry is neither a file nor a directory", async () => {
    const { RepoRegistry } = await import("../../src/config/repoRegistry.js");
    const fs = await import("node:fs");
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => false,
    } as unknown as ReturnType<typeof fs.statSync>);

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const registry = new RepoRegistry(
      "/root",
      {
        repos: [
          {
            name: "repo-a",
            directory: "repo-a",
            defaultBranch: "main",
            allowedPaths: [],
            protectedPaths: [],
            constraints: {
              requiredChecks: [],
              maxFilesChanged: 1,
              maxDiffLines: 1,
              forbiddenPatterns: [],
              mustNotTouch: [],
            },
          },
        ],
        defaultRepo: "repo-a",
      },
      logger as never,
    );

    expect(() => registry.validateWorkingDirectory("/fake/repo")).toThrow(
      /Working directory has invalid \.git entry/,
    );
  });

  it("throws when workingDirectory itself is not a directory even though .git looked valid", async () => {
    const { RepoRegistry } = await import("../../src/config/repoRegistry.js");
    const fs = await import("node:fs");
    let call = 0;
    vi.mocked(fs.statSync).mockImplementation(() => {
      call += 1;
      // First statSync call is for the .git entry (report as a valid dir);
      // second call is for workingDirectory itself (report as NOT a directory).
      if (call === 1) {
        return { isDirectory: () => true, isFile: () => false } as unknown as ReturnType<
          typeof fs.statSync
        >;
      }
      return { isDirectory: () => false, isFile: () => true } as unknown as ReturnType<
        typeof fs.statSync
      >;
    });

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const registry = new RepoRegistry(
      "/root",
      {
        repos: [
          {
            name: "repo-a",
            directory: "repo-a",
            defaultBranch: "main",
            allowedPaths: [],
            protectedPaths: [],
            constraints: {
              requiredChecks: [],
              maxFilesChanged: 1,
              maxDiffLines: 1,
              forbiddenPatterns: [],
              mustNotTouch: [],
            },
          },
        ],
        defaultRepo: "repo-a",
      },
      logger as never,
    );

    expect(() => registry.validateWorkingDirectory("/fake/repo")).toThrow(
      /Working directory path is not a directory/,
    );
  });
});
