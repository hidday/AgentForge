import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRegistry, type ReposConfig, type RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/widgets",
    directory: "widgets",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry.validateWorkingDirectory - invalid .git entry type", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repo-registry-additional-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("throws when the .git entry exists but is neither a directory nor a regular file (e.g. a FIFO)", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry();
    const config: ReposConfig = { repos: [entry], defaultRepo: entry.name };
    const registry = new RepoRegistry(root, config, logger as never);

    const dir = join(root, "weird-repo");
    mkdirSync(dir, { recursive: true });
    const gitPath = join(dir, ".git");
    // Create a named pipe (FIFO) at the `.git` path: statSync() reports it as
    // neither a directory nor a regular file, exercising the defensive
    // "invalid .git entry" branch that a normal clone or worktree never hits.
    execFileSync("mkfifo", [gitPath]);

    expect(() => registry.validateWorkingDirectory(dir)).toThrow(
      /Working directory has invalid \.git entry/,
    );
  });
});
