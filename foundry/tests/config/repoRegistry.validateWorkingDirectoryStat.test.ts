import { describe, it, expect, vi } from "vitest";
import type * as NodeFs from "node:fs";

// This file exercises the final defensive branch in
// RepoRegistry.validateWorkingDirectory: `workingDirectory` exists and has a
// valid .git entry, but the final statSync(workingDirectory) call reports it
// as not-a-directory. That combination can't be produced with a real
// filesystem through the public API (a path containing a `.git` entry is, by
// construction, a directory), so we mock the second statSync call only,
// leaving every other fs call (via the captured `actual` implementation) to
// hit the real filesystem.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    statSync: vi.fn(actual.statSync),
  };
});

describe("RepoRegistry.validateWorkingDirectory (mocked final stat)", () => {
  it("throws 'path is not a directory' when the final statSync call reports non-directory", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { RepoRegistry } = await import("../../src/config/repoRegistry.js");

    const tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-stat-test-"));
    const repoDir = join(tmpDir, "repo");
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    writeFileSync(join(repoDir, "marker.txt"), "x");

    // First statSync call inside validateWorkingDirectory is for `.git` --
    // let it run for real (the default mock implementation already forwards
    // to the real statSync). Queue a single one-time override that only
    // applies to the SECOND call, for `workingDirectory` itself.
    (statSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (statSync as unknown as ReturnType<typeof vi.fn>).getMockImplementation() as never,
    );
    (statSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      isDirectory: () => false,
      isFile: () => true,
    }));

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const registry = new RepoRegistry(
      tmpDir,
      {
        repos: [
          {
            name: "a",
            directory: repoDir,
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
        defaultRepo: "a",
      },
      logger as never,
    );

    expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
      /Working directory path is not a directory/,
    );

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
