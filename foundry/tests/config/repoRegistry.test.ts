import { describe, it, expect, vi, beforeEach } from "vitest";

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
  type RepoEntry,
  type ReposConfig,
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

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "svc-a",
    directory: "svc-a",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: ["src/generated/"],
    constraints: {
      requiredChecks: ["lint"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    vi.clearAllMocks();
  });

  it("throws when defaultRepo is not present among repos", () => {
    const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "does-not-exist" };
    expect(() => new RepoRegistry("/repos", config, logger)).toThrow(
      /Default repo "does-not-exist" not found in registry/,
    );
  });

  it("getRepoByName returns the matching entry and undefined for unknown names", () => {
    const entry = makeEntry();
    const config: ReposConfig = { repos: [entry], defaultRepo: "svc-a" };
    const registry = new RepoRegistry("/repos", config, logger);

    expect(registry.getRepoByName("svc-a")).toEqual(entry);
    expect(registry.getRepoByName("unknown-repo")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry and undefined otherwise", () => {
    const entry = makeEntry({ linearProject: "proj-1" });
    const config: ReposConfig = { repos: [entry], defaultRepo: "svc-a" };
    const registry = new RepoRegistry("/repos", config, logger);

    expect(registry.getRepoByLinearProject("proj-1")).toEqual(entry);
    expect(registry.getRepoByLinearProject("proj-none")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const entry = makeEntry();
    const config: ReposConfig = { repos: [entry], defaultRepo: "svc-a" };
    const registry = new RepoRegistry("/repos", config, logger);

    expect(registry.getDefaultRepo()).toEqual(entry);
  });

  it("listRepos returns all registered entries", () => {
    const a = makeEntry({ name: "svc-a" });
    const b = makeEntry({ name: "svc-b" });
    const config: ReposConfig = { repos: [a, b], defaultRepo: "svc-a" };
    const registry = new RepoRegistry("/repos", config, logger);

    expect(registry.listRepos()).toEqual([a, b]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const projectRepo = makeEntry({ name: "proj-repo", linearProject: "proj-1" });
      const teamRepo = makeEntry({ name: "team-repo", linearTeam: "team-1" });
      const config: ReposConfig = {
        repos: [projectRepo, teamRepo],
        defaultRepo: "proj-repo",
      };
      const registry = new RepoRegistry("/repos", config, logger);

      const result = registry.resolveForIssue("proj-1", "team-1");
      expect(result).toEqual(projectRepo);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "proj-1", repo: "proj-repo" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project does not match", () => {
      const teamRepo = makeEntry({ name: "team-repo", linearTeam: "team-1" });
      const config: ReposConfig = { repos: [teamRepo], defaultRepo: "team-repo" };
      const registry = new RepoRegistry("/repos", config, logger);

      const result = registry.resolveForIssue(undefined, "team-1");
      expect(result).toEqual(teamRepo);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "team-1", repo: "team-repo" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is provided but unmatched and no team fallback given", () => {
      const projectRepo = makeEntry({ name: "proj-repo", linearProject: "proj-1" });
      const config: ReposConfig = { repos: [projectRepo], defaultRepo: "proj-repo" };
      const registry = new RepoRegistry("/repos", config, logger);

      expect(() => registry.resolveForIssue("unknown-project")).toThrow(
        /No repo mapped to Linear project "unknown-project"/,
      );
    });

    it("falls back to the default repo when neither project nor team match", () => {
      const defaultRepo = makeEntry({ name: "default-repo" });
      const config: ReposConfig = { repos: [defaultRepo], defaultRepo: "default-repo" };
      const registry = new RepoRegistry("/repos", config, logger);

      const result = registry.resolveForIssue(undefined, "unmatched-team");
      expect(result).toEqual(defaultRepo);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "default-repo" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to default when no project or team are provided at all", () => {
      const defaultRepo = makeEntry({ name: "default-repo" });
      const config: ReposConfig = { repos: [defaultRepo], defaultRepo: "default-repo" };
      const registry = new RepoRegistry("/repos", config, logger);

      expect(registry.resolveForIssue()).toEqual(defaultRepo);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the absolute directory as-is when entry.directory is absolute", () => {
      const entry = makeEntry({ directory: "/abs/path/svc-a" });
      const config: ReposConfig = { repos: [entry], defaultRepo: "svc-a" };
      const registry = new RepoRegistry("/repos-root", config, logger);

      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/svc-a");
    });

    it("joins reposRootPath with a relative directory", () => {
      const entry = makeEntry({ directory: "svc-a" });
      const config: ReposConfig = { repos: [entry], defaultRepo: "svc-a" };
      const registry = new RepoRegistry("/repos-root", config, logger);

      expect(registry.resolveWorkingDirectory(entry)).toBe("/repos-root/svc-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    const entry = makeEntry();
    const config: ReposConfig = { repos: [entry], defaultRepo: "svc-a" };

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry("/repos-root", config, logger);
      fsMocks.existsSync.mockReturnValue(false);

      expect(() => registry.validateWorkingDirectory("/repos-root/svc-a")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when there is no .git entry", () => {
      const registry = new RepoRegistry("/repos-root", config, logger);
      fsMocks.existsSync.mockImplementation((p: string) => p === "/repos-root/svc-a");

      expect(() => registry.validateWorkingDirectory("/repos-root/svc-a")).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a .git directory (normal clone)", () => {
      const registry = new RepoRegistry("/repos-root", config, logger);
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.statSync.mockImplementation((p: string) => ({
        isDirectory: () => true,
        isFile: () => false,
      }));

      expect(() => registry.validateWorkingDirectory("/repos-root/svc-a")).not.toThrow();
    });

    it("accepts a .git file (worktree)", () => {
      const registry = new RepoRegistry("/repos-root", config, logger);
      fsMocks.existsSync.mockReturnValue(true);
      let call = 0;
      fsMocks.statSync.mockImplementation(() => {
        call += 1;
        // First statSync call checks the .git entry (file), second checks the dir itself.
        if (call === 1) {
          return { isDirectory: () => false, isFile: () => true };
        }
        return { isDirectory: () => true, isFile: () => false };
      });

      expect(() => registry.validateWorkingDirectory("/repos-root/svc-a")).not.toThrow();
    });

    it("throws when .git entry is neither a directory nor a file", () => {
      const registry = new RepoRegistry("/repos-root", config, logger);
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => false });

      expect(() => registry.validateWorkingDirectory("/repos-root/svc-a")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const registry = new RepoRegistry("/repos-root", config, logger);
      fsMocks.existsSync.mockReturnValue(true);
      let call = 0;
      fsMocks.statSync.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => true };
      });

      expect(() => registry.validateWorkingDirectory("/repos-root/svc-a")).toThrow(
        /Working directory path is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    vi.clearAllMocks();
  });

  const validConfig = {
    repos: [
      {
        name: "svc-a",
        directory: "svc-a",
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
    defaultRepo: "svc-a",
  };

  it("loads and parses the config when the configured path exists", () => {
    fsMocks.existsSync.mockImplementation((p: string) => p === "/repos.config.json");
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRepoRegistry("/repos.config.json", "/repos-root", logger);

    expect(registry.getRepoByName("svc-a")).toBeDefined();
    expect(registry.getRepoByName("svc-a")?.defaultBranch).toBe("main");
    expect(fsMocks.readFileSync).toHaveBeenCalledWith("/repos.config.json", "utf-8");
    expect(logger.info).toHaveBeenCalled();
  });

  it("falls back to the .example.json file when the configured path is missing", () => {
    fsMocks.existsSync.mockImplementation((p: string) => p === "/repos.config.example.json");
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRepoRegistry("/repos.config.json", "/repos-root", logger);

    expect(registry.getRepoByName("svc-a")).toBeDefined();
    expect(fsMocks.readFileSync).toHaveBeenCalledWith("/repos.config.example.json", "utf-8");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("throws when neither the configured path nor the example fallback exist", () => {
    fsMocks.existsSync.mockReturnValue(false);

    expect(() => loadRepoRegistry("/repos.config.json", "/repos-root", logger)).toThrow(
      /Repo config not found at \/repos\.config\.json/,
    );
  });

  it("throws when the loaded config fails schema validation", () => {
    fsMocks.existsSync.mockImplementation((p: string) => p === "/repos.config.json");
    fsMocks.readFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry("/repos.config.json", "/repos-root", logger)).toThrow();
  });
});
