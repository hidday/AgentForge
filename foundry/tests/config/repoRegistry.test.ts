import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
const statSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  statSync: (...args: unknown[]) => statSyncMock(...args),
}));

import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeConfig(overrides?: Partial<ReposConfig>): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        linearTeam: "TEAM_A",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: ["infra/"],
        constraints: baseConstraints(),
      },
      {
        name: "repo-b",
        directory: "/abs/path/repo-b",
        defaultBranch: "main",
        allowedPaths: [],
        protectedPaths: [],
        constraints: baseConstraints(),
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    statSyncMock.mockReset();
  });

  it("throws in the constructor when defaultRepo is not found in the repos list", () => {
    const logger = makeLogger();
    const config = makeConfig({ defaultRepo: "does-not-exist" });
    expect(() => new RepoRegistry("/repos", config, logger)).toThrow(
      /Default repo "does-not-exist" not found in registry/,
    );
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  describe("resolveForIssue", () => {
    it("resolves via exact project match first", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue("Project A", "TEAM_A");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project does not match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue(undefined, "TEAM_A");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "TEAM_A", repo: "repo-a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when project is provided but unmatched and no team fallback given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue(undefined, "UNKNOWN_TEAM");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team are provided", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to default when project is unmatched but a team is also given and matches nothing", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      // project unmatched, team provided but also unmatched -> not the "project && !team" throw branch
      const entry = registry.resolveForIssue("Unknown Project", "UNKNOWN_TEAM");
      expect(entry.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/repos/repo-a"));
    });

    it("resolves an absolute directory as-is", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.getRepoByName("repo-b")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/repo-b"));
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when there is no .git entry", () => {
      existsSyncMock.mockImplementation((p: string) => !p.endsWith(".git"));
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when .git exists but is neither a directory nor a file", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => false, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => true };
      });
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory path is not a directory/,
      );
    });

    it("succeeds when everything checks out (.git as a directory)", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).not.toThrow();
    });

    it("succeeds when .git is a file (worktree)", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => false, isFile: () => true };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).not.toThrow();
    });
  });

  describe("listRepos", () => {
    it("returns all registered repo entries", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const repos = registry.listRepos();
      expect(repos.map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
    });
  });
});

describe("loadRepoRegistry", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    statSyncMock.mockReset();
  });

  it("loads the config file when it exists", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/repos/repos.config.json", "/repos", logger);

    expect(registry).toBeInstanceOf(RepoRegistry);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the .example.json file when the config is missing, logging a warning", () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith(".example.json"));
    readFileSyncMock.mockReturnValue(JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/repos/repos.config.json", "/repos", logger);

    expect(registry).toBeInstanceOf(RepoRegistry);
    expect(logger.warn).toHaveBeenCalled();
    const [, message] = logger.warn.mock.calls[0];
    expect(message).toMatch(/falling back to the committed example/);
  });

  it("throws when neither the config nor the example fallback exist", () => {
    existsSyncMock.mockReturnValue(false);
    const logger = makeLogger();

    expect(() => loadRepoRegistry("/repos/repos.config.json", "/repos", logger)).toThrow(
      /Repo config not found/,
    );
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });
});
