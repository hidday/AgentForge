import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

// Only statSync needs to be a real spy (mockable per-call); everything else
// passes through to the real node:fs implementation.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn(actual.statSync) };
});

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "org/repo-a",
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

describe("RepoRegistry", () => {
  const repoA = makeRepoEntry({ name: "org/repo-a", linearProject: "Project A" });
  const repoB = makeRepoEntry({
    name: "org/repo-b",
    directory: "repo-b",
    linearTeam: "Team B",
    assigneeMe: true,
  });
  const config = makeConfig([repoA, repoB], "org/repo-a");

  it("throws when defaultRepo does not match any configured repo", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig([repoA], "org/does-not-exist"), logger as never),
    ).toThrow(/Default repo "org\/does-not-exist" not found in registry/);
  });

  it("getRepoByName / getDefaultRepo / listRepos", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(registry.getRepoByName("org/repo-a")).toEqual(repoA);
    expect(registry.getRepoByName("unknown")).toBeUndefined();
    expect(registry.getDefaultRepo()).toEqual(repoA);
    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  it("getRepoByLinearProject resolves a configured project and returns undefined otherwise", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(registry.getRepoByLinearProject("Project A")).toEqual(repoA);
    expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      const resolved = registry.resolveForIssue("Project A", "Team B");
      expect(resolved).toEqual(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "org/repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is absent", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      const resolved = registry.resolveForIssue(undefined, "Team B");
      expect(resolved).toEqual(repoB);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team B", repo: "org/repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("falls back to team-based routing when project is provided but unmatched with a matching team", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      const resolved = registry.resolveForIssue("Unmatched Project", "Team B");
      expect(resolved).toEqual(repoB);
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      expect(() => registry.resolveForIssue("Unmatched Project")).toThrow(
        /No repo mapped to Linear project "Unmatched Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      const resolved = registry.resolveForIssue();
      expect(resolved).toEqual(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "org/repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when team is given but unmatched and no project", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      const resolved = registry.resolveForIssue(undefined, "Unmatched Team");
      expect(resolved).toEqual(repoA);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the directory as-is (resolved) when it is absolute", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);
      const absoluteEntry = makeRepoEntry({ directory: "/abs/path/repo" });

      expect(registry.resolveWorkingDirectory(absoluteEntry)).toBe("/abs/path/repo");
    });

    it("joins a relative directory onto the reposRootPath", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", config, logger as never);

      expect(registry.resolveWorkingDirectory(repoA)).toBe(join("/root/workspace", "repo-a"));
    });
  });

  describe("validateWorkingDirectory", () => {
    let base: string;

    beforeEach(() => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(base, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);
      const missing = join(base, "does-not-exist");

      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);

      expect(() => registry.validateWorkingDirectory(base)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a directory whose .git entry is itself a directory (normal clone)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);
      mkdirSync(join(base, ".git"));

      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("accepts a directory whose .git entry is a file (worktree)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);
      writeFileSync(join(base, ".git"), "gitdir: /elsewhere\n");

      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("throws when the .git entry is neither a directory nor a regular file", async () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);
      const gitDir = join(base, ".git");
      mkdirSync(gitDir);

      const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
      const mockedStatSync = vi.mocked(fs.statSync);
      mockedStatSync.mockImplementation(((path: fs.PathLike, options?: unknown) => {
        if (path === gitDir) {
          return { isDirectory: () => false, isFile: () => false } as unknown as fs.Stats;
        }
        return (realFs.statSync as (p: fs.PathLike, o?: unknown) => fs.Stats)(path, options);
      }) as typeof fs.statSync);

      try {
        expect(() => registry.validateWorkingDirectory(base)).toThrow(
          /Working directory has invalid \.git entry/,
        );
      } finally {
        mockedStatSync.mockImplementation(realFs.statSync);
      }
    });

    it("throws when the working directory path itself is not a directory", async () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", config, logger as never);
      mkdirSync(join(base, ".git"));

      const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
      const mockedStatSync = vi.mocked(fs.statSync);
      mockedStatSync.mockImplementation(((path: fs.PathLike, options?: unknown) => {
        if (path === base) {
          return { isDirectory: () => false, isFile: () => false } as unknown as fs.Stats;
        }
        return (realFs.statSync as (p: fs.PathLike, o?: unknown) => fs.Stats)(path, options);
      }) as typeof fs.statSync);

      try {
        expect(() => registry.validateWorkingDirectory(base)).toThrow(
          /Working directory path is not a directory/,
        );
      } finally {
        mockedStatSync.mockImplementation(realFs.statSync);
      }
    });
  });
});

describe("loadRepoRegistry", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("loads and parses a repos.config.json that exists at the given path", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    const raw: ReposConfig = makeConfig([makeRepoEntry()], "org/repo-a");
    writeFileSync(configPath, JSON.stringify(raw));

    const registry = loadRepoRegistry(configPath, base, logger as never);

    expect(registry.getDefaultRepo().name).toBe("org/repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 1, defaultRepo: "org/repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json template when the configured path is missing", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    const examplePath = join(base, "repos.config.example.json");
    const raw: ReposConfig = makeConfig([makeRepoEntry({ name: "example/repo" })], "example/repo");
    writeFileSync(examplePath, JSON.stringify(raw));

    const registry = loadRepoRegistry(configPath, base, logger as never);

    expect(registry.getDefaultRepo().name).toBe("example/repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the configured path nor the example fallback exists", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, base, logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a zod validation error when the config file has an invalid shape", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    // repos must have at least 1 entry (min(1))
    expect(() => loadRepoRegistry(configPath, base, logger as never)).toThrow();
  });

  it("applies the defaultBranch default of 'main' when not specified in the config", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    const entryWithoutBranch = {
      name: "org/repo-a",
      directory: "repo-a",
      allowedPaths: [],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    };
    writeFileSync(
      configPath,
      JSON.stringify({ repos: [entryWithoutBranch], defaultRepo: "org/repo-a" }),
    );

    const registry = loadRepoRegistry(configPath, base, logger as never);
    expect(registry.getDefaultRepo().defaultBranch).toBe("main");
  });
});
