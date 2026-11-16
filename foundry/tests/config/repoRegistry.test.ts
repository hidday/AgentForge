import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, join } from "node:path";
import { ZodError } from "zod";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync, existsSync, statSync } from "node:fs";
import { RepoRegistry, loadRepoRegistry, type ReposConfig, type RepoEntry } from "../../src/config/repoRegistry.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeConstraints() {
  return {
    requiredChecks: ["ci"],
    maxFilesChanged: 10,
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
    allowedPaths: [],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  const repoA = makeRepoEntry({ name: "repo-a", directory: "repo-a", linearProject: "proj-a" });
  const repoB = makeRepoEntry({
    name: "repo-b",
    directory: "/abs/repo-b",
    linearTeam: "team-b",
    assigneeMe: true,
  });
  const defaultRepo = makeRepoEntry({ name: "repo-default", directory: "repo-default" });

  function makeConfig(): ReposConfig {
    return { repos: [repoA, repoB, defaultRepo], defaultRepo: "repo-default" };
  }

  it("throws when config.defaultRepo is not found among the repos", () => {
    const logger = makeMockLogger();
    const badConfig: ReposConfig = { repos: [repoA], defaultRepo: "does-not-exist" };
    expect(() => new RepoRegistry("/root", badConfig, logger as never)).toThrow(
      /Default repo "does-not-exist" not found in registry/,
    );
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const logger = makeMockLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getRepoByName("repo-a")).toBe(repoA);
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const logger = makeMockLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getRepoByLinearProject("proj-a")).toBe(repoA);
    expect(registry.getRepoByLinearProject("missing")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const logger = makeMockLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getDefaultRepo()).toBe(defaultRepo);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("proj-a", undefined);
      expect(entry).toBe(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "proj-a", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when the project does not match", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, "team-b");
      expect(entry).toBe(repoB);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "team-b", repo: "repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given but unmatched and no team is given", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.resolveForIssue("unknown-project", undefined)).toThrow(
        /No repo mapped to Linear project "unknown-project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, undefined);
      expect(entry).toBe(defaultRepo);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-default" },
        "Issue has no Linear project or team match, using default repo",
      );
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory on its own", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(registry.resolveWorkingDirectory(repoB)).toBe(resolve("/abs/repo-b"));
    });

    it("resolves a relative directory against reposRootPath", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(registry.resolveWorkingDirectory(repoA)).toBe(resolve(join("/root", "repo-a")));
    });
  });

  describe("validateWorkingDirectory", () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReset();
      vi.mocked(statSync).mockReset();
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      vi.mocked(existsSync).mockReturnValue(false);

      expect(() => registry.validateWorkingDirectory("/work/dir")).toThrow(
        /Working directory does not exist: \/work\/dir/,
      );
    });

    it("throws when the .git entry is missing", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      vi.mocked(existsSync).mockImplementation((p) => p === "/work/dir");

      expect(() => registry.validateWorkingDirectory("/work/dir")).toThrow(
        "Working directory is not a git repository: /work/dir",
      );
    });

    it("throws when the .git entry is neither a file nor a directory", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const gitDir = join("/work/dir", ".git");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((p) => {
        if (p === gitDir) {
          return { isDirectory: () => false, isFile: () => false } as never;
        }
        return { isDirectory: () => true, isFile: () => false } as never;
      });

      expect(() => registry.validateWorkingDirectory("/work/dir")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const gitDir = join("/work/dir", ".git");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((p) => {
        if (p === gitDir) {
          return { isDirectory: () => true, isFile: () => false } as never;
        }
        return { isDirectory: () => false, isFile: () => false } as never;
      });

      expect(() => registry.validateWorkingDirectory("/work/dir")).toThrow(
        /Working directory path is not a directory: \/work\/dir/,
      );
    });

    it("does not throw on a fully valid working directory", () => {
      const logger = makeMockLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as never);

      expect(() => registry.validateWorkingDirectory("/work/dir")).not.toThrow();
    });
  });

  it("listRepos returns all configured repo entries", () => {
    const logger = makeMockLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.listRepos()).toEqual([repoA, repoB, defaultRepo]);
  });
});

describe("loadRepoRegistry", () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(statSync).mockReset();
  });

  function validConfigJson(): string {
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "only-repo", directory: "only-repo" })],
      defaultRepo: "only-repo",
    };
    return JSON.stringify(config);
  }

  it("loads and parses the config when the config path exists", () => {
    const logger = makeMockLogger();
    const configPath = "/configs/repos.config.json";
    const resolvedPath = resolve(configPath);
    vi.mocked(existsSync).mockImplementation((p) => p === resolvedPath);
    vi.mocked(readFileSync).mockReturnValue(validConfigJson());

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(readFileSync).toHaveBeenCalledWith(resolvedPath, "utf-8");
    expect(registry.getRepoByName("only-repo")).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: resolvedPath, repoCount: 1, defaultRepo: "only-repo" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the config path is missing, and warns", () => {
    const logger = makeMockLogger();
    const configPath = "/configs/repos.config.json";
    const resolvedPath = resolve(configPath);
    const examplePath = resolvedPath.replace(/\.json$/, ".example.json");
    vi.mocked(existsSync).mockImplementation((p) => p === examplePath);
    vi.mocked(readFileSync).mockReturnValue(validConfigJson());

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(readFileSync).toHaveBeenCalledWith(examplePath, "utf-8");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolvedPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
    expect(registry.getRepoByName("only-repo")).toBeDefined();
  });

  it("throws when neither the config path nor the example fallback exists", () => {
    const logger = makeMockLogger();
    const configPath = "/configs/repos.config.json";
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow(
      /Repo config not found/,
    );
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("throws a ZodError when the config file has an invalid shape", () => {
    const logger = makeMockLogger();
    const configPath = "/configs/repos.config.json";
    const resolvedPath = resolve(configPath);
    vi.mocked(existsSync).mockImplementation((p) => p === resolvedPath);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow(ZodError);
  });
});
