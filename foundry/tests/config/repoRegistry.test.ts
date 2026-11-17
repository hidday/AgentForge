import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  statSync: mockStatSync,
}));

const { RepoRegistry, loadRepoRegistry } = await import("../../src/config/repoRegistry.js");
type RepoEntry = import("../../src/config/repoRegistry.js").RepoEntry;

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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

describe("RepoRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the configured defaultRepo does not match any entry", () => {
    const logger = makeLogger();
    expect(
      () =>
        new RepoRegistry(
          "/repos",
          { repos: [makeEntry({ name: "repo-a" })], defaultRepo: "missing" },
          logger as never,
        ),
    ).toThrow(/Default repo "missing" not found in registry/);
  });

  it("getRepoByName / getDefaultRepo / listRepos reflect the configured entries", () => {
    const logger = makeLogger();
    const repoA = makeEntry({ name: "repo-a" });
    const repoB = makeEntry({ name: "repo-b", directory: "repo-b" });
    const registry = new RepoRegistry(
      "/repos",
      { repos: [repoA, repoB], defaultRepo: "repo-b" },
      logger as never,
    );

    expect(registry.getRepoByName("repo-a")).toBe(repoA);
    expect(registry.getRepoByName("nope")).toBeUndefined();
    expect(registry.getDefaultRepo()).toBe(repoB);
    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a", linearProject: "Backend" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      const resolved = registry.resolveForIssue("Backend", undefined);
      expect(resolved).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Backend", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project does not match", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a", linearTeam: "platform" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      const resolved = registry.resolveForIssue(undefined, "platform");
      expect(resolved).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "platform", repo: "repo-a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given, unmatched, and no team is provided", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a", linearProject: "Backend" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also unmatched", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a", linearProject: "Backend" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      const resolved = registry.resolveForIssue("Unknown Project", "unknown-team");
      expect(resolved).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      expect(registry.resolveForIssue()).toBe(repoA);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the directory unchanged (resolved) when it is absolute", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a", directory: "/abs/path/repo-a" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      expect(registry.resolveWorkingDirectory(repoA)).toBe("/abs/path/repo-a");
    });

    it("joins a relative directory onto the repos root path", () => {
      const logger = makeLogger();
      const repoA = makeEntry({ name: "repo-a", directory: "repo-a" });
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );

      expect(registry.resolveWorkingDirectory(repoA)).toBe("/repos/repo-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const repoA = makeEntry();
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );
      mockExistsSync.mockReturnValue(false);

      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when there is no .git entry", () => {
      const logger = makeLogger();
      const repoA = makeEntry();
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );
      mockExistsSync.mockImplementation((p: string) => !p.endsWith(".git"));

      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when .git exists but is neither a directory nor a file", () => {
      const logger = makeLogger();
      const repoA = makeEntry();
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => false, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const logger = makeLogger();
      const repoA = makeEntry();
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).toThrow(
        /Working directory path is not a directory/,
      );
    });

    it("does not throw for a well-formed git clone directory", () => {
      const logger = makeLogger();
      const repoA = makeEntry();
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });

      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).not.toThrow();
    });

    it("does not throw when .git is a worktree file", () => {
      const logger = makeLogger();
      const repoA = makeEntry();
      const registry = new RepoRegistry(
        "/repos",
        { repos: [repoA], defaultRepo: "repo-a" },
        logger as never,
      );
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(".git")) {
          return { isDirectory: () => false, isFile: () => true };
        }
        return { isDirectory: () => true, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/repos/repo-a")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function validConfigJson() {
    return JSON.stringify({
      repos: [
        {
          name: "repo-a",
          directory: "repo-a",
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
    });
  }

  it("loads and parses the config file when it exists at the configured path", () => {
    const logger = makeLogger();
    mockExistsSync.mockImplementation((p: string) => !p.endsWith(".example.json") || false);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(validConfigJson());

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/repos", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the .example.json template with a warning when the configured path is missing", () => {
    const logger = makeLogger();
    mockExistsSync.mockImplementation((p: string) => p.endsWith(".example.json"));
    mockReadFileSync.mockReturnValue(validConfigJson());

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/repos", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [warnPayload] = logger.warn.mock.calls[0] as [{ expected: string; fallback: string }];
    expect(warnPayload.fallback).toMatch(/\.example\.json$/);
  });

  it("throws when neither the configured path nor the example fallback exist", () => {
    const logger = makeLogger();
    mockExistsSync.mockReturnValue(false);

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/repos", logger as never)).toThrow(
      /Repo config not found/,
    );
  });
});
