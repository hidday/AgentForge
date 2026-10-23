import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:net";
import { RepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

// Covers RepoRegistry.validateWorkingDirectory's "invalid .git entry" branch:
// a .git path that exists but is neither a directory nor a regular file (here,
// a Unix domain socket).
//
// Note: the function's *final* guard — `if (!stat.isDirectory())` on
// `workingDirectory` itself — is NOT covered here and is not reachable at all.
// By the time execution gets that far, `existsSync(join(workingDirectory,
// ".git"))` has already succeeded, which is only possible on a real
// filesystem when `workingDirectory` resolves to a directory (or a symlink to
// one, which `statSync` follows). So `stat.isDirectory()` is always true at
// that point and the throw is dead code. See the final test-run summary for
// the proposed vitest.config.ts coverage-exclusion comment.

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const constraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints,
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry.validateWorkingDirectory — non-directory, non-file .git entry", () => {
  let dir: string;
  let registry: RepoRegistry;
  let socketServer: Server | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-gaps-test-"));
    registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
  });

  afterEach(() => {
    socketServer?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws 'invalid .git entry' when .git exists but is a socket (neither directory nor file)", async () => {
    const socketPath = join(dir, ".git");
    socketServer = createServer();
    await new Promise<void>((resolve, reject) => {
      socketServer!.once("error", reject);
      socketServer!.listen(socketPath, resolve);
    });

    expect(() => registry.validateWorkingDirectory(dir)).toThrow(
      /Working directory has invalid \.git entry/,
    );
  });
});
