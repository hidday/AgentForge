import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, resolve } from "node:path";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync, existsSync, statSync } from "node:fs";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
  type RepoConstraints,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

const baseConstraints: RepoConstraints = {
  requiredChecks: ["ci"],
  maxFilesChanged: 20,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: ["package-lock.json"],
};

function makeRepo(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: ["src/**"],
    protectedPaths: ["package-lock.json"],
    constraints: baseConstraints,
    ...overrides,
  };
}

describe("RepoRegistry constructor", () => {
  it("throws a descriptive error when defaultRepo is not among the configured repos", () => {
    const config: ReposConfig = {
      repos: [makeRepo({ name: "repo-a" })],
      defaultRepo: "does-not-exist",
    };
    expect(() => new RepoRegistry("/repos", config, makeLogger())).toThrow(
      /Default repo "does-not-exist" not found in registry\. Available: repo-a/,
    );
  });

  it("builds project and team lookup maps only from entries that declare them", () => {
    const withProject = makeRepo({ name: "repo-a", linearProject: "proj-a" });
    const withTeam = makeRepo({ name: "repo-b", directory: "repo-b", linearTeam: "team-b" });
    const withNeither = makeRepo({ name: "repo-c", directory: "repo-c" });
    const config: ReposConfig = {
      repos: [withProject, withTeam, withNeither],
      defaultRepo: "repo-c",
    };
    const registry = new RepoRegistry("/repos", config, makeLogger());

    expect(registry.getRepoByLinearProject("proj-a")).toBe(withProject);
    expect(registry.getRepoByLinearProject("team-b")).toBeUndefined();
    // Team routing is indexed separately from the project map, and resolves via resolveForIssue.
    expect(registry.resolveForIssue(undefined, "team-b")).toBe(withTeam);
    expect(registry.resolveForIssue("proj-a", undefined)).toBe(withProject);
  });
});

describe("RepoRegistry lookups", () => {
  const repoA = makeRepo({ name: "repo-a", linearProject: "proj-a" });
  const repoB = makeRepo({ name: "repo-b", directory: "repo-b", linearTeam: "team-b" });
  const config: ReposConfig = {
    repos: [repoA, repoB],
    defaultRepo: "repo-a",
  };
  let logger: Logger;
  let registry: RepoRegistry;

  beforeEach(() => {
    logger = makeLogger();
    registry = new RepoRegistry("/repos", config, logger);
  });

  it("getRepoByName returns the matching entry", () => {
    expect(registry.getRepoByName("repo-a")).toBe(repoA);
  });

  it("getRepoByName returns undefined for an unknown name", () => {
    expect(registry.getRepoByName("unknown")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry", () => {
    expect(registry.getRepoByLinearProject("proj-a")).toBe(repoA);
  });

  it("getRepoByLinearProject returns undefined for an unmapped project", () => {
    expect(registry.getRepoByLinearProject("unknown-project")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    expect(registry.getDefaultRepo()).toBe(repoA);
  });

  it("listRepos returns all configured entries", () => {
    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const result = registry.resolveForIssue("proj-a", undefined);
      expect(result).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "proj-a", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when there is no project", () => {
      const result = registry.resolveForIssue(undefined, "team-b");
      expect(result).toBe(repoB);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "team-b", repo: "repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("prefers project match over team when both are provided and the project matches", () => {
      const result = registry.resolveForIssue("proj-a", "team-b");
      expect(result).toBe(repoA);
    });

    it("throws when a project is given, unmatched, and no team is given at all", () => {
      expect(() => registry.resolveForIssue("unmapped-project", undefined)).toThrow(
        /No repo mapped to Linear project "unmapped-project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given (even if the team doesn't match)", () => {
      const result = registry.resolveForIssue("unmapped-project", "unmapped-team");
      expect(result).toBe(repoA); // repoA is the default
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team are given", () => {
      const result = registry.resolveForIssue(undefined, undefined);
      expect(result).toBe(repoA);
    });

    it("falls back to the default repo when team is given but unmatched and no project given", () => {
      const result = registry.resolveForIssue(undefined, "unmapped-team");
      expect(result).toBe(repoA);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the absolute directory unchanged (resolved) when the entry directory is absolute", () => {
      const entry = makeRepo({ directory: "/abs/path/to/repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/to/repo"));
    });

    it("joins a relative directory onto the repos root path", () => {
      const entry = makeRepo({ directory: "relative-repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(
        resolve(join("/repos", "relative-repo")),
      );
    });
  });

  describe("validateWorkingDirectory", () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReset();
      vi.mocked(statSync).mockReset();
    });

    it("throws when the working directory does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(() => registry.validateWorkingDirectory("/repos/missing")).toThrow(
        /Working directory does not exist: \/repos\/missing/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      vi.mocked(existsSync).mockImplementation((path) => path === "/repos/no-git");
      expect(() => registry.validateWorkingDirectory("/repos/no-git")).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when .git exists but is neither a directory nor a file", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((path) => {
        if (path === join("/repos/weird-git", ".git")) {
          return { isDirectory: () => false, isFile: () => false } as ReturnType<typeof statSync>;
        }
        return { isDirectory: () => true, isFile: () => false } as ReturnType<typeof statSync>;
      });
      expect(() => registry.validateWorkingDirectory("/repos/weird-git")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((path) => {
        if (path === join("/repos/not-a-dir", ".git")) {
          return { isDirectory: () => true, isFile: () => false } as ReturnType<typeof statSync>;
        }
        return { isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>;
      });
      expect(() => registry.validateWorkingDirectory("/repos/not-a-dir")).toThrow(
        /Working directory path is not a directory: \/repos\/not-a-dir/,
      );
    });

    it("passes when .git is a directory (normal clone) and the working directory is a directory", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as ReturnType<typeof statSync>);
      expect(() => registry.validateWorkingDirectory("/repos/clone")).not.toThrow();
    });

    it("passes when .git is a file (worktree) and the working directory is a directory", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((path) => {
        if (path === join("/repos/worktree", ".git")) {
          return { isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>;
        }
        return { isDirectory: () => true, isFile: () => false } as ReturnType<typeof statSync>;
      });
      expect(() => registry.validateWorkingDirectory("/repos/worktree")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  const logger = makeLogger();
  const validConfig = {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        allowedPaths: ["src/**"],
        protectedPaths: [],
        constraints: baseConstraints,
      },
    ],
    defaultRepo: "repo-a",
  };

  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(statSync).mockReset();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.info).mockClear();
  });

  it("loads and parses the config at the given path when it exists", () => {
    const configPath = "./repos.config.json";
    const resolvedPath = resolve(configPath);
    vi.mocked(existsSync).mockImplementation((path) => path === resolvedPath);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRepoRegistry(configPath, "/repos", logger);

    expect(registry.getRepoByName("repo-a")).toBeDefined();
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: resolvedPath, repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the .example.json file when the configured path is missing but the example exists", () => {
    const configPath = "./repos.config.json";
    const resolvedPath = resolve(configPath);
    const examplePath = resolvedPath.replace(/\.json$/, ".example.json");
    vi.mocked(existsSync).mockImplementation((path) => path === examplePath);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRepoRegistry(configPath, "/repos", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolvedPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
    expect(readFileSync).toHaveBeenCalledWith(examplePath, "utf-8");
  });

  it("throws when neither the configured path nor the example exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => loadRepoRegistry("./repos.config.json", "/repos", logger)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a zod validation error when the config file content does not match the schema", () => {
    const configPath = "./repos.config.json";
    const resolvedPath = resolve(configPath);
    vi.mocked(existsSync).mockImplementation((path) => path === resolvedPath);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry(configPath, "/repos", logger)).toThrow();
  });
});
