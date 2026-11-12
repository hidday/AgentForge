import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeMockLogger() {
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

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "main-repo",
    directory: "main-repo",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  const reposRoot = "/workspace";

  it("throws when the configured defaultRepo is not among the repos", () => {
    const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "does-not-exist" };
    expect(() => new RepoRegistry(reposRoot, config, makeMockLogger() as never)).toThrow(
      /Default repo "does-not-exist" not found in registry. Available: main-repo/,
    );
  });

  it("getRepoByName returns the entry or undefined", () => {
    const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
    const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
    expect(registry.getRepoByName("main-repo")?.name).toBe("main-repo");
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getDefaultRepo returns the resolved default entry", () => {
    const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
    const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
    expect(registry.getDefaultRepo().name).toBe("main-repo");
  });

  it("getRepoByLinearProject looks up by the linearProject key", () => {
    const config: ReposConfig = {
      repos: [makeEntry(), makeEntry({ name: "proj-repo", linearProject: "PROJ-1" })],
      defaultRepo: "main-repo",
    };
    const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
    expect(registry.getRepoByLinearProject("PROJ-1")?.name).toBe("proj-repo");
    expect(registry.getRepoByLinearProject("NOPE")).toBeUndefined();
  });

  it("listRepos returns all configured entries", () => {
    const config: ReposConfig = {
      repos: [makeEntry(), makeEntry({ name: "second" })],
      defaultRepo: "main-repo",
    };
    const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["main-repo", "second"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeMockLogger();
      const config: ReposConfig = {
        repos: [
          makeEntry(),
          makeEntry({ name: "proj-repo", linearProject: "PROJ-1", linearTeam: "TEAM-1" }),
        ],
        defaultRepo: "main-repo",
      };
      const registry = new RepoRegistry(reposRoot, config, logger as never);
      const entry = registry.resolveForIssue("PROJ-1", "TEAM-1");
      expect(entry.name).toBe("proj-repo");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "PROJ-1", repo: "proj-repo" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when the project does not match", () => {
      const logger = makeMockLogger();
      const config: ReposConfig = {
        repos: [makeEntry(), makeEntry({ name: "team-repo", linearTeam: "TEAM-1" })],
        defaultRepo: "main-repo",
      };
      const registry = new RepoRegistry(reposRoot, config, logger as never);
      const entry = registry.resolveForIssue(undefined, "TEAM-1");
      expect(entry.name).toBe("team-repo");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "TEAM-1", repo: "team-repo" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is provided, does not match, and no team is given", () => {
      const config: ReposConfig = {
        repos: [makeEntry({ linearProject: "OTHER" })],
        defaultRepo: "main-repo",
      };
      const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
      expect(() => registry.resolveForIssue("UNMATCHED")).toThrow(
        /No repo mapped to Linear project "UNMATCHED"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given and unmatched", () => {
      const logger = makeMockLogger();
      const config: ReposConfig = {
        repos: [makeEntry({ linearProject: "OTHER" })],
        defaultRepo: "main-repo",
      };
      const registry = new RepoRegistry(reposRoot, config, logger as never);
      const entry = registry.resolveForIssue("UNMATCHED", "ALSO-UNMATCHED");
      expect(entry.name).toBe("main-repo");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "main-repo" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
      const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
      expect(registry.resolveForIssue().name).toBe("main-repo");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("joins a relative directory under the repos root", () => {
      const config: ReposConfig = {
        repos: [makeEntry({ directory: "sub/dir" })],
        defaultRepo: "main-repo",
      };
      const registry = new RepoRegistry("/workspace", config, makeMockLogger() as never);
      expect(registry.resolveWorkingDirectory(registry.getDefaultRepo())).toBe(
        join("/workspace", "sub/dir"),
      );
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const config: ReposConfig = {
        repos: [makeEntry({ directory: "/abs/path/repo" })],
        defaultRepo: "main-repo",
      };
      const registry = new RepoRegistry("/workspace", config, makeMockLogger() as never);
      expect(registry.resolveWorkingDirectory(registry.getDefaultRepo())).toBe("/abs/path/repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
      const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
      expect(() => registry.validateWorkingDirectory("/does/not/exist")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
      const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /is not a git repository/,
      );
    });

    it("accepts a directory with a .git directory (normal clone)", () => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      mkdirSync(join(dir, ".git"));
      const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
      const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a directory with a .git file (worktree)", () => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
      const config: ReposConfig = { repos: [makeEntry()], defaultRepo: "main-repo" };
      const registry = new RepoRegistry(reposRoot, config, makeMockLogger() as never);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: unknown) {
    writeFileSync(path, JSON.stringify(config));
  }

  it("loads a valid config file directly", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, {
      repos: [
        {
          name: "main-repo",
          directory: "main-repo",
          allowedPaths: [],
          protectedPaths: [],
          constraints: makeConstraints(),
        },
      ],
      defaultRepo: "main-repo",
    });
    const logger = makeMockLogger();
    const registry = loadRepoRegistry(configPath, dir, logger as never);
    expect(registry.getDefaultRepo().name).toBe("main-repo");
    // defaultBranch default should apply
    expect(registry.getDefaultRepo().defaultBranch).toBe("main");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "main-repo" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, {
      repos: [
        {
          name: "example-repo",
          directory: "example-repo",
          allowedPaths: [],
          protectedPaths: [],
          constraints: makeConstraints(),
        },
      ],
      defaultRepo: "example-repo",
    });
    const logger = makeMockLogger();
    const registry = loadRepoRegistry(configPath, dir, logger as never);
    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config nor the example file exist", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, dir, makeMockLogger() as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws a zod validation error when the config file is malformed", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "x" });
    expect(() => loadRepoRegistry(configPath, dir, makeMockLogger() as never)).toThrow();
  });
});
