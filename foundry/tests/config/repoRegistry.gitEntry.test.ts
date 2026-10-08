import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { RepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

const config: ReposConfig = {
  repos: [
    {
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
    },
  ],
  defaultRepo: "repo-a",
} as ReposConfig;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let base: string | undefined;
afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true });
  base = undefined;
});

describe("RepoRegistry.validateWorkingDirectory — invalid .git entry", () => {
  it("rejects a .git entry that is neither a directory nor a file (e.g. a FIFO)", () => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-fifo-"));
    const gitPath = join(base, ".git");
    execFileSync("mkfifo", [gitPath]);
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(() => registry.validateWorkingDirectory(base!)).toThrow(
      `Working directory has invalid .git entry: ${gitPath}. ` +
        "Expected a directory (clone) or file (worktree).",
    );
  });
});
