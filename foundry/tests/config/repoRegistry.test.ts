import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger & { debugCalls: unknown[][]; warnCalls: unknown[][] } {
  const debugCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  return {
    debug: (...args: unknown[]) => debugCalls.push(args),
    warn: (...args: unknown[]) => warnCalls.push(args),
    info: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => makeLogger(),
    debugCalls,
    warnCalls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 20,
    maxDiffLines: 1000,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  const logger = makeLogger();

  it("throws when the configured defaultRepo is not present among the repos", () => {
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-missing");
    expect(() => new RepoRegistry("/workspace", config, logger)).toThrow(
      /Default repo "repo-missing" not found in registry\. Available: repo-a/,
    );
  });

  it("getRepoByName returns the matching entry and undefined for unknown names", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const config = makeConfig([repoA], "repo-a");
    const registry = new RepoRegistry("/workspace", config, logger);

    expect(registry.getRepoByName("repo-a")).toBe(repoA);
    expect(registry.getRepoByName("does-not-exist")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry and undefined when unmapped", () => {
    const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
    const repoB = makeRepoEntry({ name: "repo-b" });
    const config = makeConfig([repoA, repoB], "repo-a");
    const registry = new RepoRegistry("/workspace", config, logger);

    expect(registry.getRepoByLinearProject("Project A")).toBe(repoA);
    expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const config = makeConfig([repoA], "repo-a");
    const registry = new RepoRegistry("/workspace", config, logger);

    expect(registry.getDefaultRepo()).toBe(repoA);
  });

  it("listRepos returns all registered entries", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const repoB = makeRepoEntry({ name: "repo-b" });
    const config = makeConfig([repoA, repoB], "repo-a");
    const registry = new RepoRegistry("/workspace", config, logger);

    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoA, repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      const resolved = registry.resolveForIssue("Project A", undefined);
      expect(resolved).toBe(repoA);
    });

    it("falls back to team-based routing when no project is given", () => {
      const repoA = makeRepoEntry({
        name: "repo-a",
        linearTeam: "Team A",
        assigneeMe: true,
      });
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoA, repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      const resolved = registry.resolveForIssue(undefined, "Team A");
      expect(resolved).toBe(repoA);
    });

    it("falls back to team routing when the project is unmatched but a team is provided", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearTeam: "Team A" });
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoA, repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      const resolved = registry.resolveForIssue("Unmapped Project", "Team A");
      expect(resolved).toBe(repoA);
    });

    it("throws when a project is given, unmatched, and no team is provided", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoA, repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      expect(() => registry.resolveForIssue("Unmapped Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unmapped Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      const resolved = registry.resolveForIssue();
      expect(resolved).toBe(repoDefault);
    });

    it("falls back to the default repo when project and team are both provided but unmatched", () => {
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      // project is set, so the "unmatched project + no team" throw branch is only
      // taken when team is falsy; here team is provided but doesn't match either,
      // so it should silently fall through to the default repo.
      const resolved = registry.resolveForIssue("Unmapped Project", "Unmapped Team");
      expect(resolved).toBe(repoDefault);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace", config, logger);

      const entry = makeRepoEntry({ directory: "/abs/path/repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo");
    });

    it("joins a relative directory onto the repos root path", () => {
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config = makeConfig([repoDefault], "repo-default");
      const registry = new RepoRegistry("/workspace/root", config, logger);

      const entry = makeRepoEntry({ directory: "my-repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/workspace/root/my-repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const repoDefault = makeRepoEntry({ name: "repo-default" });
    const config = makeConfig([repoDefault], "repo-default");

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry("/workspace", config, logger);
      const missing = join(dir, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const registry = new RepoRegistry("/workspace", config, logger);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (a normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const registry = new RepoRegistry("/workspace", config, logger);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (a worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /some/other/path\n");
      const registry = new RepoRegistry("/workspace", config, logger);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws the 'not a git repository' error for a file path (no .git entry can exist under a file)", () => {
      const filePath = join(dir, "not-a-dir");
      writeFileSync(filePath, "hello");
      const registry = new RepoRegistry("/workspace", config, logger);
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when .git exists but is neither a directory nor a regular file (e.g. a FIFO)", () => {
      const gitPath = join(dir, ".git");
      execFileSync("mkfifo", [gitPath]);
      const registry = new RepoRegistry("/workspace", config, logger);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });
  });

  describe("validateWorkingDirectory defensive final check", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.doUnmock("node:fs");
    });

    it("throws 'is not a directory' if the working directory path itself fails the final isDirectory check", async () => {
      // This branch is defensive: under normal POSIX semantics, if `${workingDirectory}/.git`
      // exists, workingDirectory must itself be a directory. We exercise it by mocking fs so
      // the earlier checks (exists, .git exists, .git is a directory) all pass, but the final
      // stat of workingDirectory itself reports a non-directory.
      vi.resetModules();
      vi.doMock("node:fs", async () => {
        const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
        return {
          ...actual,
          existsSync: () => true,
          statSync: (p: string) => {
            if (p.endsWith(".git")) {
              return { isDirectory: () => true, isFile: () => false } as ReturnType<
                typeof actual.statSync
              >;
            }
            return { isDirectory: () => false, isFile: () => false } as ReturnType<
              typeof actual.statSync
            >;
          },
        };
      });

      const { RepoRegistry: MockedRepoRegistry } = await import(
        "../../src/config/repoRegistry.js"
      );
      const config2 = makeConfig([makeRepoEntry({ name: "repo-default" })], "repo-default");
      const registry = new MockedRepoRegistry("/workspace", config2, logger);

      expect(() => registry.validateWorkingDirectory("/fake/not-really-a-dir")).toThrow(
        /Working directory path is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  const logger = makeLogger();
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads and parses a valid repos.config.json", () => {
    const configPath = join(dir, "repos.config.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, "/workspace", logger);
    expect(registry.getRepoByName("repo-a")).toBeDefined();
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("falls back to the <name>.example.json file when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    const config: ReposConfig = makeConfig(
      [makeRepoEntry({ name: "placeholder-repo" })],
      "placeholder-repo",
    );
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, "/workspace", logger);
    expect(registry.getRepoByName("placeholder-repo")).toBeDefined();
    expect(logger.warnCalls.length).toBeGreaterThan(0);
  });

  it("throws when neither the configured path nor the example fallback exists", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, "/workspace", logger)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the JSON content does not match the expected schema", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    // repos must have at least 1 entry (z.array(...).min(1)).
    expect(() => loadRepoRegistry(configPath, "/workspace", logger)).toThrow();
  });

  it("applies the default branch of 'main' when defaultBranch is omitted", () => {
    const configPath = join(dir, "repos.config.json");
    const rawRepo = {
      name: "repo-a",
      directory: "repo-a",
      allowedPaths: [],
      protectedPaths: [],
      constraints: makeConstraints(),
    };
    writeFileSync(configPath, JSON.stringify({ repos: [rawRepo], defaultRepo: "repo-a" }));

    const registry = loadRepoRegistry(configPath, "/workspace", logger);
    expect(registry.getRepoByName("repo-a")?.defaultBranch).toBe("main");
  });
});
