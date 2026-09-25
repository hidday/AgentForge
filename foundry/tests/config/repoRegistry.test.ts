import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, join } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type RepoEntry,
  type ReposConfig,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

const { existsSyncMock, statSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  readFileSync: readFileSyncMock,
}));

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "org/repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: {
      requiredChecks: ["lint"],
      maxFilesChanged: 30,
      maxDiffLines: 2000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RepoRegistry constructor", () => {
  it("throws listing available repos when defaultRepo is not found", () => {
    const repos = [makeRepoEntry({ name: "org/repo-a" }), makeRepoEntry({ name: "org/repo-b" })];
    const config: ReposConfig = { repos, defaultRepo: "org/missing" };

    expect(() => new RepoRegistry("/root", config, makeMockLogger() as unknown as Logger)).toThrow(
      'Default repo "org/missing" not found in registry. Available: org/repo-a, org/repo-b',
    );
  });
});

describe("RepoRegistry lookups", () => {
  const repoA = makeRepoEntry({
    name: "org/repo-a",
    linearProject: "ProjectA",
    linearTeam: undefined,
  });
  const repoB = makeRepoEntry({
    name: "org/repo-b",
    linearProject: undefined,
    linearTeam: "ENG",
    assigneeMe: true,
  });
  const repoDefault = makeRepoEntry({ name: "org/default-repo" });
  const config: ReposConfig = {
    repos: [repoA, repoB, repoDefault],
    defaultRepo: "org/default-repo",
  };

  function buildRegistry(logger = makeMockLogger()) {
    return {
      registry: new RepoRegistry("/root", config, logger as unknown as Logger),
      logger,
    };
  }

  it("getRepoByName returns the matching entry or undefined", () => {
    const { registry } = buildRegistry();
    expect(registry.getRepoByName("org/repo-a")).toBe(repoA);
    expect(registry.getRepoByName("org/nonexistent")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const { registry } = buildRegistry();
    expect(registry.getRepoByLinearProject("ProjectA")).toBe(repoA);
    expect(registry.getRepoByLinearProject("NoSuchProject")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const { registry } = buildRegistry();
    expect(registry.getDefaultRepo()).toBe(repoDefault);
  });

  it("listRepos returns all entries", () => {
    const { registry } = buildRegistry();
    expect(registry.listRepos()).toEqual([repoA, repoB, repoDefault]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const { registry, logger } = buildRegistry();
      const result = registry.resolveForIssue("ProjectA", "ENG");
      expect(result).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "ProjectA", repo: "org/repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is absent or unmatched", () => {
      const { registry, logger } = buildRegistry();
      const result = registry.resolveForIssue(undefined, "ENG");
      expect(result).toBe(repoB);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "ENG", repo: "org/repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given but unmatched and no team is given", () => {
      const { registry } = buildRegistry();
      expect(() => registry.resolveForIssue("NoSuchProject", undefined)).toThrow(
        'No repo mapped to Linear project "NoSuchProject". Configured projects: [ProjectA]. ' +
          'Add a matching "linearProject" entry in repos.config.json.',
      );
    });

    it("falls back to the default repo when project is unmatched but a (also unmatched) team is given", () => {
      const { registry, logger } = buildRegistry();
      const result = registry.resolveForIssue("NoSuchProject", "NoSuchTeam");
      expect(result).toBe(repoDefault);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "org/default-repo" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const { registry } = buildRegistry();
      expect(registry.resolveForIssue()).toBe(repoDefault);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const { registry } = buildRegistry();
      const entry = makeRepoEntry({ directory: "/abs/path/repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/repo"));
    });

    it("joins a relative directory onto reposRootPath", () => {
      const { registry } = buildRegistry();
      const entry = makeRepoEntry({ directory: "relative-repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(
        resolve(join("/root", "relative-repo")),
      );
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      const { registry } = buildRegistry();
      existsSyncMock.mockReturnValue(false);

      expect(() => registry.validateWorkingDirectory("/tmp/missing")).toThrow(
        "Working directory does not exist: /tmp/missing. Ensure the repository is cloned at this path, or update repos.config.json and REPOS_ROOT_PATH.",
      );
    });

    it("throws when .git is missing", () => {
      const { registry } = buildRegistry();
      existsSyncMock.mockImplementation((p: string) => p === "/tmp/repo");

      expect(() => registry.validateWorkingDirectory("/tmp/repo")).toThrow(
        `Working directory is not a git repository: /tmp/repo. Expected a .git entry at ${join("/tmp/repo", ".git")}.`,
      );
    });

    it("throws when .git exists but is neither a directory nor a file", () => {
      const { registry } = buildRegistry();
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/tmp/repo", ".git")) {
          return { isDirectory: () => false, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/tmp/repo")).toThrow(
        `Working directory has invalid .git entry: ${join("/tmp/repo", ".git")}. Expected a directory (clone) or file (worktree).`,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const { registry } = buildRegistry();
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/tmp/repo", ".git")) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => true };
      });

      expect(() => registry.validateWorkingDirectory("/tmp/repo")).toThrow(
        "Working directory path is not a directory: /tmp/repo.",
      );
    });

    it("succeeds silently for a valid clone (.git directory)", () => {
      const { registry } = buildRegistry();
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/tmp/repo", ".git")) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/tmp/repo")).not.toThrow();
    });

    it("succeeds silently for a valid worktree (.git file)", () => {
      const { registry } = buildRegistry();
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/tmp/repo", ".git")) {
          return { isDirectory: () => false, isFile: () => true };
        }
        return { isDirectory: () => true, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/tmp/repo")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  const validConfig = {
    repos: [
      {
        name: "org/repo-a",
        directory: "repo-a",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 100,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
    defaultRepo: "org/repo-a",
  };

  it("loads and parses the config at the given path when it exists", () => {
    existsSyncMock.mockImplementation((p: string) => p === resolve("/cfg/repos.config.json"));
    readFileSyncMock.mockReturnValue(JSON.stringify(validConfig));
    const logger = makeMockLogger();

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/root", logger as unknown as Logger);

    expect(readFileSyncMock).toHaveBeenCalledWith(resolve("/cfg/repos.config.json"), "utf-8");
    expect(registry.getDefaultRepo().name).toBe("org/repo-a");
    // defaultBranch defaults to "main" via schema default.
    expect(registry.getDefaultRepo().defaultBranch).toBe("main");
    expect(logger.info).toHaveBeenCalledWith(
      {
        configPath: resolve("/cfg/repos.config.json"),
        repoCount: 1,
        defaultRepo: "org/repo-a",
      },
      "Loaded repo registry",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the .example.json file when the primary config is missing", () => {
    existsSyncMock.mockImplementation(
      (p: string) => p === resolve("/cfg/repos.config.example.json"),
    );
    readFileSyncMock.mockReturnValue(JSON.stringify(validConfig));
    const logger = makeMockLogger();

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/root", logger as unknown as Logger);

    expect(readFileSyncMock).toHaveBeenCalledWith(resolve("/cfg/repos.config.example.json"), "utf-8");
    expect(registry.getDefaultRepo().name).toBe("org/repo-a");
    expect(logger.warn).toHaveBeenCalledWith(
      {
        expected: resolve("/cfg/repos.config.json"),
        fallback: resolve("/cfg/repos.config.example.json"),
      },
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config nor the example fallback exists", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() =>
      loadRepoRegistry("/cfg/repos.config.json", "/root", makeMockLogger() as unknown as Logger),
    ).toThrow(
      `Repo config not found at ${resolve("/cfg/repos.config.json")} and no example fallback at ${resolve("/cfg/repos.config.example.json")}.`,
    );
  });

  it("throws a zod validation error when the config file content is invalid", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() =>
      loadRepoRegistry("/cfg/repos.config.json", "/root", makeMockLogger() as unknown as Logger),
    ).toThrow();
  });

  it("throws when the config file contains invalid JSON", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("{not valid json");

    expect(() =>
      loadRepoRegistry("/cfg/repos.config.json", "/root", makeMockLogger() as unknown as Logger),
    ).toThrow();
  });
});
