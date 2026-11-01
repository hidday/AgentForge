import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const constraints = {
  requiredChecks: [],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

function makeConfig(overrides?: Partial<ReposConfig>): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        linearTeam: "TEAM-A",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints,
      },
      {
        name: "repo-b",
        directory: "repo-b",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints,
      },
    ],
    defaultRepo: "repo-b",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo is not among the repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "missing" }), logger as never),
    ).toThrow(/Default repo "missing" not found in registry/);
  });

  it("resolves by exact Linear project match before falling back", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    const entry = registry.resolveForIssue("Project A", undefined);
    expect(entry.name).toBe("repo-a");
    expect(logger.debug).toHaveBeenCalledWith(
      { project: "Project A", repo: "repo-a" },
      "Resolved repo from Linear project",
    );
  });

  it("falls back to team-based routing when the project does not match but the team does", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    const entry = registry.resolveForIssue(undefined, "TEAM-A");
    expect(entry.name).toBe("repo-a");
    expect(logger.debug).toHaveBeenCalledWith(
      { team: "TEAM-A", repo: "repo-a" },
      "Resolved repo from Linear team",
    );
  });

  it("throws when a project is given but unmatched and no team is given", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
      /No repo mapped to Linear project "Unknown Project"/,
    );
  });

  it("falls back to the default repo when neither project nor team match", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    const entry = registry.resolveForIssue("Unknown Project", "unknown-team");
    expect(entry.name).toBe("repo-b");
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "repo-b" },
      "Issue has no Linear project or team match, using default repo",
    );
  });

  it("falls back to the default repo when neither project nor team is provided", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(registry.resolveForIssue().name).toBe("repo-b");
  });

  it("getRepoByName and getRepoByLinearProject look up individual entries", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("missing")).toBeUndefined();
  });

  it("getDefaultRepo and listRepos expose the full config", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(registry.listRepos().map((r) => r.name)).toEqual(["repo-a", "repo-b"]);
  });

  it("resolveWorkingDirectory resolves a relative directory against the repos root", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    const entry = registry.getRepoByName("repo-a")!;

    expect(registry.resolveWorkingDirectory(entry)).toBe(join("/root", "repo-a"));
  });

  it("resolveWorkingDirectory passes through an absolute directory untouched", () => {
    const logger = makeLogger();
    const config = makeConfig();
    config.repos[0]!.directory = "/absolute/repo-a";
    const registry = new RepoRegistry("/root", config, logger as never);
    const entry = registry.getRepoByName("repo-a")!;

    expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/repo-a");
  });
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when the working directory does not exist", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(() => registry.validateWorkingDirectory(join(tmpDir, "missing"))).toThrow(
      /Working directory does not exist/,
    );
  });

  it("throws when the directory exists but has no .git entry", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
      /Working directory is not a git repository/,
    );
  });

  it("accepts a directory whose .git entry is a directory (a normal clone)", () => {
    mkdirSync(join(tmpDir, ".git"));
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
  });

  it("accepts a directory whose .git entry is a file (a worktree)", () => {
    writeFileSync(join(tmpDir, ".git"), "gitdir: /elsewhere/.git\n");
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);

    expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
  });
});

describe("loadRepoRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses a valid repos.config.json", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.listRepos()).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 2, defaultRepo: "repo-b" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the committed *.example.json when the primary config is missing", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.listRepos()).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the config nor the example fallback exists", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON structure", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow();
  });
});
