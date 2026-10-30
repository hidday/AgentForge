import { describe, it, expect, vi } from "vitest";

// Isolated in its own file because it mocks node:fs's statSync to force the
// "workingDirectory itself is not a directory" branch in
// validateWorkingDirectory — a state that can't be constructed on a real
// filesystem (if .git exists as a child entry, the parent must be a
// directory). All other fs calls pass through to the real implementation.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: vi.fn((path: Parameters<typeof actual.statSync>[0], ...rest: unknown[]) => {
      if (String(path).endsWith("fake-working-dir") && !String(path).includes(".git")) {
        return { isDirectory: () => false, isFile: () => false } as ReturnType<
          typeof actual.statSync
        >;
      }
      return (actual.statSync as (...a: unknown[]) => unknown)(path, ...rest);
    }),
  };
});

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRegistry, type ReposConfig, type RepoEntry } from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
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
    ...overrides,
  };
}

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry.validateWorkingDirectory — non-directory working dir", () => {
  it("throws when the working directory path itself is not a directory", () => {
    const parent = mkdtempSync(join(tmpdir(), "repo-registry-statguard-"));
    const workingDir = join(parent, "fake-working-dir");
    mkdirSync(workingDir);
    mkdirSync(join(workingDir, ".git"));

    try {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      expect(() => registry.validateWorkingDirectory(workingDir)).toThrow(
        /is not a directory/,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
