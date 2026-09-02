import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type RepoEntry,
  type ReposConfig,
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
    requiredChecks: ["lint", "typecheck", "tests"],
    maxFilesChanged: 30,
    maxDiffLines: 2000,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> & { name: string }): RepoEntry {
  return {
    directory: "some-dir",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("throws when defaultRepo does not match any configured repo", () => {
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-missing",
    };

    expect(() => new RepoRegistry("/root", config, logger as never)).toThrow(
      /Default repo "repo-missing" not found in registry\. Available: repo-a/,
    );
  });

  it("getRepoByName returns the matching entry and undefined for unknown names", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const config: ReposConfig = { repos: [repoA], defaultRepo: "repo-a" };
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(registry.getRepoByName("repo-a")).toEqual(repoA);
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject resolves via the linearProject index", () => {
    const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project X" });
    const repoB = makeRepoEntry({ name: "repo-b" });
    const config: ReposConfig = { repos: [repoA, repoB], defaultRepo: "repo-a" };
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(registry.getRepoByLinearProject("Project X")).toEqual(repoA);
    expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const config: ReposConfig = { repos: [repoA], defaultRepo: "repo-a" };
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(registry.getDefaultRepo()).toEqual(repoA);
  });

  it("listRepos returns all configured entries", () => {
    const repoA = makeRepoEntry({ name: "repo-a" });
    const repoB = makeRepoEntry({ name: "repo-b" });
    const config: ReposConfig = { repos: [repoA, repoB], defaultRepo: "repo-a" };
    const registry = new RepoRegistry("/root", config, logger as never);

    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const repoByProject = makeRepoEntry({ name: "repo-project", linearProject: "Project X" });
      const repoByTeam = makeRepoEntry({
        name: "repo-team",
        linearTeam: "ENG",
        assigneeMe: true,
      });
      const repoDefault = makeRepoEntry({ name: "repo-default" });
      const config: ReposConfig = {
        repos: [repoByProject, repoByTeam, repoDefault],
        defaultRepo: "repo-default",
      };
      return {
        registry: new RepoRegistry("/root", config, logger as never),
        repoByProject,
        repoByTeam,
        repoDefault,
      };
    }

    it("resolves by exact Linear project match first", () => {
      const { registry, repoByProject } = buildRegistry();

      const result = registry.resolveForIssue("Project X", "ENG");

      expect(result).toEqual(repoByProject);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project X", repo: "repo-project" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is absent", () => {
      const { registry, repoByTeam } = buildRegistry();

      const result = registry.resolveForIssue(undefined, "ENG");

      expect(result).toEqual(repoByTeam);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "ENG", repo: "repo-team" },
        "Resolved repo from Linear team",
      );
    });

    it("falls back to team-based routing when project is provided but unmatched and team matches", () => {
      const { registry, repoByTeam } = buildRegistry();

      const result = registry.resolveForIssue("Unknown Project", "ENG");

      expect(result).toEqual(repoByTeam);
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const { registry } = buildRegistry();

      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"\. Configured projects: \[Project X\]/,
      );
    });

    it("falls back to the default repo when project and team are both absent", () => {
      const { registry, repoDefault } = buildRegistry();

      const result = registry.resolveForIssue();

      expect(result).toEqual(repoDefault);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-default" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when project and team are both provided but unmatched", () => {
      const { registry, repoDefault } = buildRegistry();

      const result = registry.resolveForIssue("Unknown Project", "unknown-team");

      expect(result).toEqual(repoDefault);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const repoA = makeRepoEntry({ name: "repo-a", directory: "sub/dir" });
      const config: ReposConfig = { repos: [repoA], defaultRepo: "repo-a" };
      const registry = new RepoRegistry("/repos-root", config, logger as never);

      expect(registry.resolveWorkingDirectory(repoA)).toBe(join("/repos-root", "sub", "dir"));
    });

    it("resolves an absolute directory as-is, ignoring the repos root path", () => {
      const repoA = makeRepoEntry({ name: "repo-a", directory: "/absolute/path" });
      const config: ReposConfig = { repos: [repoA], defaultRepo: "repo-a" };
      const registry = new RepoRegistry("/repos-root", config, logger as never);

      expect(registry.resolveWorkingDirectory(repoA)).toBe("/absolute/path");
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpDir: string;
    let registry: RepoRegistry;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      const repoA = makeRepoEntry({ name: "repo-a" });
      const config: ReposConfig = { repos: [repoA], defaultRepo: "repo-a" };
      registry = new RepoRegistry("/root", config, logger as never);
    });

    it("throws when the working directory does not exist", () => {
      const missing = join(tmpDir, "does-not-exist");

      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        `Working directory does not exist: ${missing}.`,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const dir = join(tmpDir, "no-git");
      mkdirSync(dir);

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a working directory whose .git entry is a real directory (normal clone)", () => {
      const dir = join(tmpDir, "clone");
      mkdirSync(join(dir, ".git"), { recursive: true });

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a working directory whose .git entry is a file (git worktree)", () => {
      const dir = join(tmpDir, "worktree");
      mkdirSync(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/worktree\n");

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when .git exists but is neither a file nor a directory (e.g. a FIFO)", () => {
      const dir = join(tmpDir, "weird-git");
      mkdirSync(dir);
      const gitPath = join(dir, ".git");
      try {
        execFileSync("mkfifo", [gitPath]);
      } catch {
        // mkfifo unavailable in this environment; skip this environment-specific branch.
        return;
      }

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let logger: ReturnType<typeof makeLogger>;
  let tmpDir: string;

  beforeEach(() => {
    logger = makeLogger();
    tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  function writeConfig(path: string, config: unknown) {
    writeFileSync(path, JSON.stringify(config, null, 2));
  }

  it("loads a valid config file directly and logs the summary", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeConfig(configPath, {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    });

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json template when the config file is missing", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    writeConfig(examplePath, {
      repos: [makeRepoEntry({ name: "example-repo" })],
      defaultRepo: "example-repo",
    });

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.getRepoByName("example-repo")?.name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config file nor its example fallback exist", () => {
    const configPath = join(tmpDir, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws when the config file contains invalid JSON", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, "{ not valid json");

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow();
  });

  it("throws when the config file fails schema validation", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "repo-a" });

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow();
  });

  it("cleans up temp fixtures after use", () => {
    // Sanity check: ensure the temp directory used across these tests is removable,
    // guarding against leftover fixtures polluting the OS temp dir between runs.
    expect(() => rmSync(tmpDir, { recursive: true, force: true })).not.toThrow();
  });
});
