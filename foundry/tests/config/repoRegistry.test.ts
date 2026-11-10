import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, join } from "node:path";

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
  statSync: fsMocks.statSync,
}));

import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when defaultRepo is not present among the configured repos", () => {
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "missing-repo");
    expect(() => new RepoRegistry("/root", config, makeLogger() as never)).toThrow(
      /Default repo "missing-repo" not found/,
    );
  });

  it("getRepoByName / getDefaultRepo / listRepos reflect the configured entries", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const repoB = makeRepoEntry({ name: "repo-b" });
    const registry = new RepoRegistry("/root", makeConfig([repoA, repoB], "repo-a"), makeLogger() as never);

    expect(registry.getRepoByName("repo-a")).toBe(repoA);
    expect(registry.getRepoByName("nope")).toBeUndefined();
    expect(registry.getDefaultRepo()).toBe(repoA);
    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  it("getRepoByLinearProject looks up an entry by its linearProject key", () => {
    const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
    const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);

    expect(registry.getRepoByLinearProject("Project A")).toBe(repoA);
    expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const repoB = makeRepoEntry({ name: "repo-b" });
      const logger = makeLogger();
      const registry = new RepoRegistry(
        "/root",
        makeConfig([repoA, repoB], "repo-b"),
        logger as never,
      );

      const result = registry.resolveForIssue("Project A");
      expect(result).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when no project is given", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearTeam: "Team A" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);

      const result = registry.resolveForIssue(undefined, "Team A");
      expect(result).toBe(repoA);
    });

    it("falls back to team-based routing when project is unmatched but a team is given", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearTeam: "Team A" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);

      const result = registry.resolveForIssue("Unknown Project", "Team A");
      expect(result).toBe(repoA);
    });

    it("throws when project is given, unmatched, and no team is provided", () => {
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Known Project" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);

      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const repoA = makeRepoEntry({ name: "repo-a" });
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);

      const result = registry.resolveForIssue();
      expect(result).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when a team is given but has no mapping", () => {
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);

      const result = registry.resolveForIssue(undefined, "Unmapped Team");
      expect(result).toBe(repoA);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const repoA = makeRepoEntry({ name: "repo-a", directory: "/abs/path/repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);

      expect(registry.resolveWorkingDirectory(repoA)).toBe(resolve("/abs/path/repo-a"));
    });

    it("joins a relative directory under the repos root path", () => {
      const repoA = makeRepoEntry({ name: "repo-a", directory: "repo-a" });
      const registry = new RepoRegistry("/root/base", makeConfig([repoA], "repo-a"), makeLogger() as never);

      expect(registry.resolveWorkingDirectory(repoA)).toBe(resolve(join("/root/base", "repo-a")));
    });
  });

  describe("validateWorkingDirectory", () => {
    function makeRegistry() {
      const repoA = makeRepoEntry({ name: "repo-a" });
      return new RepoRegistry("/root", makeConfig([repoA], "repo-a"), makeLogger() as never);
    }

    it("throws when the working directory does not exist", () => {
      const registry = makeRegistry();
      fsMocks.existsSync.mockReturnValue(false);

      expect(() => registry.validateWorkingDirectory("/work/repo-a")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const registry = makeRegistry();
      fsMocks.existsSync.mockImplementation((p: string) => !p.endsWith(".git"));

      expect(() => registry.validateWorkingDirectory("/work/repo-a")).toThrow(
        /not a git repository/,
      );
    });

    it("throws when .git exists but is neither a file nor a directory", () => {
      const registry = makeRegistry();
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => false });

      expect(() => registry.validateWorkingDirectory("/work/repo-a")).toThrow(
        /invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const registry = makeRegistry();
      fsMocks.existsSync.mockReturnValue(true);
      let call = 0;
      fsMocks.statSync.mockImplementation(() => {
        call += 1;
        // first statSync call is for the .git entry (valid dir), second is for
        // the working directory path itself (not a directory)
        if (call === 1) return { isDirectory: () => true, isFile: () => false };
        return { isDirectory: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/work/repo-a")).toThrow(
        /is not a directory/,
      );
    });

    it("does not throw for a valid clone (directory .git) and a valid working directory", () => {
      const registry = makeRegistry();
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });

      expect(() => registry.validateWorkingDirectory("/work/repo-a")).not.toThrow();
    });

    it("does not throw for a valid worktree (.git as a file)", () => {
      const registry = makeRegistry();
      fsMocks.existsSync.mockReturnValue(true);
      let call = 0;
      fsMocks.statSync.mockImplementation(() => {
        call += 1;
        if (call === 1) return { isDirectory: () => false, isFile: () => true };
        return { isDirectory: () => true };
      });

      expect(() => registry.validateWorkingDirectory("/work/repo-a")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and parses a valid config file", () => {
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/root", logger as never);

    expect(registry).toBeInstanceOf(RepoRegistry);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json template when the configured path is missing", () => {
    const config = makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo");
    fsMocks.existsSync.mockImplementation((p: string) => p.endsWith(".example.json"));
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [warnPayload] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(String(warnPayload.fallback)).toContain(".example.json");
    expect(fsMocks.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".example.json"),
      "utf-8",
    );
  });

  it("throws when the configured path and the example fallback are both missing", () => {
    fsMocks.existsSync.mockReturnValue(false);

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/root", makeLogger() as never)).toThrow(
      /Repo config not found/,
    );
    expect(fsMocks.readFileSync).not.toHaveBeenCalled();
  });

  it("throws when the config file contains malformed JSON", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue("{ not valid json");

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/root", makeLogger() as never)).toThrow();
  });

  it("throws a schema validation error when the config is well-formed JSON but invalid", () => {
    fsMocks.existsSync.mockReturnValue(true);
    // missing required fields: repos entries need `constraints`, and `defaultRepo` is absent
    fsMocks.readFileSync.mockReturnValue(JSON.stringify({ repos: [{ name: "x" }] }));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/root", makeLogger() as never)).toThrow();
  });

  it("throws when repos is an empty array (min(1) schema constraint)", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/root", makeLogger() as never)).toThrow();
  });
});
