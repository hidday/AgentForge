import { describe, it, expect, vi, beforeEach } from "vitest";

const existsSync = vi.fn();
const statSync = vi.fn();
const readFileSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  statSync: (...args: unknown[]) => statSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
}));

import { RepoRegistry, loadRepoRegistry, type RepoEntry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConstraints() {
  return {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry construction", () => {
  it("throws when defaultRepo does not match any configured repo name", () => {
    const logger = makeLogger();
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "missing-repo",
    };
    expect(() => new RepoRegistry("/root", config, logger)).toThrow(
      /Default repo "missing-repo" not found in registry\. Available: repo-a/,
    );
  });

  it("indexes repos by name, linearProject, and linearTeam", () => {
    const logger = makeLogger();
    const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
    const repoB = makeRepoEntry({ name: "repo-b", linearTeam: "Team B", assigneeMe: true });
    const config: ReposConfig = { repos: [repoA, repoB], defaultRepo: "repo-a" };

    const registry = new RepoRegistry("/root", config, logger);

    expect(registry.getRepoByName("repo-a")).toBe(repoA);
    expect(registry.getRepoByName("repo-b")).toBe(repoB);
    expect(registry.getRepoByLinearProject("Project A")).toBe(repoA);
    expect(registry.getDefaultRepo()).toBe(repoA);
    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  it("returns undefined for an unknown repo name or linear project", () => {
    const logger = makeLogger();
    const repoA = makeRepoEntry({ name: "repo-a" });
    const registry = new RepoRegistry("/root", { repos: [repoA], defaultRepo: "repo-a" }, logger);

    expect(registry.getRepoByName("nope")).toBeUndefined();
    expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
  });
});

describe("RepoRegistry.resolveForIssue", () => {
  function makeRegistry() {
    const logger = makeLogger();
    const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
    const repoB = makeRepoEntry({ name: "repo-b", linearTeam: "Team B", assigneeMe: true });
    const defaultRepo = makeRepoEntry({ name: "repo-default" });
    const registry = new RepoRegistry(
      "/root",
      { repos: [repoA, repoB, defaultRepo], defaultRepo: "repo-default" },
      logger,
    );
    return { registry, repoA, repoB, defaultRepo, logger };
  }

  it("resolves by exact Linear project match first", () => {
    const { registry, repoA, logger } = makeRegistry();
    expect(registry.resolveForIssue("Project A", undefined)).toBe(repoA);
    expect(logger.debug).toHaveBeenCalledWith(
      { project: "Project A", repo: "repo-a" },
      "Resolved repo from Linear project",
    );
  });

  it("falls back to team-based routing when no project match", () => {
    const { registry, repoB, logger } = makeRegistry();
    expect(registry.resolveForIssue(undefined, "Team B")).toBe(repoB);
    expect(logger.debug).toHaveBeenCalledWith(
      { team: "Team B", repo: "repo-b" },
      "Resolved repo from Linear team",
    );
  });

  it("throws when a project is given, is unmatched, and no team is given", () => {
    const { registry } = makeRegistry();
    expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
      /No repo mapped to Linear project "Unknown Project"/,
    );
  });

  it("falls back to the default repo when project is unmatched but a team is also given (even if the team itself is unmatched)", () => {
    const { registry, defaultRepo } = makeRegistry();
    expect(registry.resolveForIssue("Unknown Project", "Unknown Team")).toBe(defaultRepo);
  });

  it("falls back to the default repo when neither project nor team is given", () => {
    const { registry, defaultRepo, logger } = makeRegistry();
    expect(registry.resolveForIssue(undefined, undefined)).toBe(defaultRepo);
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "repo-default" },
      "Issue has no Linear project or team match, using default repo",
    );
  });

  it("prefers project match over team match when both are given and the project matches", () => {
    const { registry, repoA } = makeRegistry();
    expect(registry.resolveForIssue("Project A", "Team B")).toBe(repoA);
  });
});

describe("RepoRegistry.resolveWorkingDirectory", () => {
  it("returns the directory unchanged (resolved) when it is absolute", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ directory: "/abs/path/repo" });
    const registry = new RepoRegistry("/root", { repos: [entry], defaultRepo: "repo-a" }, logger);
    expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo");
  });

  it("joins a relative directory onto the repos root path", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ directory: "relative-repo" });
    const registry = new RepoRegistry(
      "/root/repos",
      { repos: [entry], defaultRepo: "repo-a" },
      logger,
    );
    expect(registry.resolveWorkingDirectory(entry)).toBe("/root/repos/relative-repo");
  });
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  function makeRegistry() {
    const logger = makeLogger();
    const entry = makeRepoEntry();
    return new RepoRegistry("/root", { repos: [entry], defaultRepo: "repo-a" }, logger);
  }

  beforeEach(() => {
    existsSync.mockReset();
    statSync.mockReset();
  });

  it("throws when the working directory does not exist", () => {
    const registry = makeRegistry();
    existsSync.mockReturnValue(false);

    expect(() => registry.validateWorkingDirectory("/does/not/exist")).toThrow(
      /Working directory does not exist: \/does\/not\/exist/,
    );
  });

  it("throws when there is no .git entry", () => {
    const registry = makeRegistry();
    existsSync.mockImplementation((p: string) => p === "/repo");

    expect(() => registry.validateWorkingDirectory("/repo")).toThrow(
      /Working directory is not a git repository: \/repo/,
    );
  });

  it("throws when .git exists but is neither a file nor a directory", () => {
    const registry = makeRegistry();
    existsSync.mockReturnValue(true);
    statSync.mockImplementation((p: string) => {
      if (p === "/repo/.git") {
        return { isDirectory: () => false, isFile: () => false };
      }
      return { isDirectory: () => true, isFile: () => false };
    });

    expect(() => registry.validateWorkingDirectory("/repo")).toThrow(
      /Working directory has invalid \.git entry: \/repo\/\.git/,
    );
  });

  it("accepts a normal clone where .git is a directory", () => {
    const registry = makeRegistry();
    existsSync.mockReturnValue(true);
    statSync.mockImplementation((p: string) => {
      if (p === "/repo/.git") {
        return { isDirectory: () => true, isFile: () => false };
      }
      return { isDirectory: () => true, isFile: () => false };
    });

    expect(() => registry.validateWorkingDirectory("/repo")).not.toThrow();
  });

  it("accepts a worktree where .git is a file", () => {
    const registry = makeRegistry();
    existsSync.mockReturnValue(true);
    statSync.mockImplementation((p: string) => {
      if (p === "/repo/.git") {
        return { isDirectory: () => false, isFile: () => true };
      }
      return { isDirectory: () => true, isFile: () => false };
    });

    expect(() => registry.validateWorkingDirectory("/repo")).not.toThrow();
  });

  it("throws when the working directory path itself is not a directory", () => {
    // Not reachable through a real filesystem (a .git entry can only exist
    // under an actual directory), but the guard is exercised here directly
    // via mocked fs calls for completeness.
    const registry = makeRegistry();
    existsSync.mockReturnValue(true);
    statSync.mockImplementation((p: string) => {
      if (p === "/repo/.git") {
        return { isDirectory: () => true, isFile: () => false };
      }
      return { isDirectory: () => false, isFile: () => true };
    });

    expect(() => registry.validateWorkingDirectory("/repo")).toThrow(
      /Working directory path is not a directory: \/repo/,
    );
  });
});

describe("loadRepoRegistry", () => {
  const validConfig = {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: makeConstraints(),
      },
    ],
    defaultRepo: "repo-a",
  };

  beforeEach(() => {
    existsSync.mockReset();
    readFileSync.mockReset();
  });

  it("loads and parses a valid config file, applying schema defaults", () => {
    existsSync.mockImplementation((p: string) => p === "/config/repos.config.json");
    readFileSync.mockReturnValue(JSON.stringify(validConfig));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/config/repos.config.json", "/root", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.getDefaultRepo().defaultBranch).toBe("main"); // schema default applied
    expect(logger.info).toHaveBeenCalledWith(
      { configPath: "/config/repos.config.json", repoCount: 1, defaultRepo: "repo-a" },
      "Loaded repo registry",
    );
  });

  it("falls back to the example config when the live config is missing", () => {
    existsSync.mockImplementation((p: string) => p === "/config/repos.config.example.json");
    readFileSync.mockReturnValue(JSON.stringify(validConfig));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/config/repos.config.json", "/root", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: "/config/repos.config.json",
        fallback: "/config/repos.config.example.json",
      }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config nor the example config exist", () => {
    existsSync.mockReturnValue(false);
    const logger = makeLogger();

    expect(() => loadRepoRegistry("/config/repos.config.json", "/root", logger)).toThrow(
      /Repo config not found at \/config\/repos\.config\.json and no example fallback at \/config\/repos\.config\.example\.json/,
    );
  });

  it("throws a schema validation error for a malformed config (invalid field type)", () => {
    existsSync.mockImplementation((p: string) => p === "/config/repos.config.json");
    readFileSync.mockReturnValue(
      JSON.stringify({
        repos: [{ ...validConfig.repos[0], constraints: { ...makeConstraints(), maxFilesChanged: -1 } }],
        defaultRepo: "repo-a",
      }),
    );
    const logger = makeLogger();

    expect(() => loadRepoRegistry("/config/repos.config.json", "/root", logger)).toThrow();
  });

  it("throws when the config has zero repos", () => {
    existsSync.mockImplementation((p: string) => p === "/config/repos.config.json");
    readFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "repo-a" }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry("/config/repos.config.json", "/root", logger)).toThrow();
  });

  it("throws when the config file contains invalid JSON", () => {
    existsSync.mockImplementation((p: string) => p === "/config/repos.config.json");
    readFileSync.mockReturnValue("{ not valid json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry("/config/repos.config.json", "/root", logger)).toThrow();
  });
});
