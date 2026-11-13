import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/widgets",
    directory: "./widgets",
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

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry construction", () => {
  it("throws when defaultRepo does not match any configured repo", () => {
    const logger = makeLogger();
    const config = makeConfig([makeRepoEntry({ name: "a" })], "does-not-exist");

    expect(() => new RepoRegistry("/repos", config, logger as never)).toThrow(
      /Default repo "does-not-exist" not found in registry\. Available: a/,
    );
  });

  it("constructs successfully when defaultRepo matches a configured repo", () => {
    const logger = makeLogger();
    const config = makeConfig([makeRepoEntry({ name: "a" })], "a");

    const registry = new RepoRegistry("/repos", config, logger as never);
    expect(registry.getDefaultRepo().name).toBe("a");
  });
});

describe("RepoRegistry.getRepoByName / getRepoByLinearProject / getDefaultRepo / listRepos", () => {
  const logger = makeLogger();
  const repoA = makeRepoEntry({ name: "repoA", linearProject: "Project A" });
  const repoB = makeRepoEntry({ name: "repoB" });
  const registry = new RepoRegistry("/repos", makeConfig([repoA, repoB], "repoA"), logger as never);

  it("getRepoByName returns the matching entry or undefined", () => {
    expect(registry.getRepoByName("repoA")?.name).toBe("repoA");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repoA");
    expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default", () => {
    expect(registry.getDefaultRepo().name).toBe("repoA");
  });

  it("listRepos returns all configured repos", () => {
    const names = registry.listRepos().map((r) => r.name);
    expect(names.sort()).toEqual(["repoA", "repoB"]);
  });
});

describe("RepoRegistry.resolveForIssue", () => {
  let logger: ReturnType<typeof makeLogger>;
  let registry: RepoRegistry;

  beforeEach(() => {
    logger = makeLogger();
    const repoByProject = makeRepoEntry({ name: "repoProject", linearProject: "Backend" });
    const repoByTeam = makeRepoEntry({ name: "repoTeam", linearTeam: "PRY", assigneeMe: true });
    const repoDefault = makeRepoEntry({ name: "repoDefault" });
    registry = new RepoRegistry(
      "/repos",
      makeConfig([repoByProject, repoByTeam, repoDefault], "repoDefault"),
      logger as never,
    );
  });

  it("resolves by exact Linear project match first", () => {
    const entry = registry.resolveForIssue("Backend", "PRY");
    expect(entry.name).toBe("repoProject");
    expect(logger.debug).toHaveBeenCalledWith(
      { project: "Backend", repo: "repoProject" },
      "Resolved repo from Linear project",
    );
  });

  it("falls back to team-based routing when project doesn't match but team does", () => {
    const entry = registry.resolveForIssue(undefined, "PRY");
    expect(entry.name).toBe("repoTeam");
    expect(logger.debug).toHaveBeenCalledWith(
      { team: "PRY", repo: "repoTeam" },
      "Resolved repo from Linear team",
    );
  });

  it("throws when project is provided, unmatched, and no team is given", () => {
    expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
      /No repo mapped to Linear project "Unknown Project"/,
    );
  });

  it("falls back to the default repo when project is unmatched but a team is provided that also doesn't match", () => {
    const entry = registry.resolveForIssue("Unknown Project", "UnknownTeam");
    expect(entry.name).toBe("repoDefault");
  });

  it("falls back to the default repo when neither project nor team is provided", () => {
    const entry = registry.resolveForIssue();
    expect(entry.name).toBe("repoDefault");
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "repoDefault" },
      "Issue has no Linear project or team match, using default repo",
    );
  });
});

describe("RepoRegistry.resolveWorkingDirectory", () => {
  const logger = makeLogger();

  it("resolves a relative directory against reposRootPath", () => {
    const entry = makeRepoEntry({ name: "a", directory: "widgets" });
    const registry = new RepoRegistry("/repos-root", makeConfig([entry], "a"), logger as never);

    expect(registry.resolveWorkingDirectory(entry)).toBe("/repos-root/widgets");
  });

  it("returns an absolute directory as-is (resolved)", () => {
    const entry = makeRepoEntry({ name: "a", directory: "/abs/path/widgets" });
    const registry = new RepoRegistry("/repos-root", makeConfig([entry], "a"), logger as never);

    expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/widgets");
  });
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  const logger = makeLogger();
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRegistry(): RepoRegistry {
    const entry = makeRepoEntry({ name: "a" });
    return new RepoRegistry(tmpDir, makeConfig([entry], "a"), logger as never);
  }

  it("throws when the working directory does not exist", () => {
    const registry = makeRegistry();
    const missing = join(tmpDir, "does-not-exist");
    expect(() => registry.validateWorkingDirectory(missing)).toThrow(
      /Working directory does not exist/,
    );
  });

  it("throws when the directory exists but has no .git entry", () => {
    const registry = makeRegistry();
    const repoDir = join(tmpDir, "no-git");
    mkdirSync(repoDir);
    expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
      /Working directory is not a git repository/,
    );
  });

  it("succeeds when .git is a directory (normal clone)", () => {
    const registry = makeRegistry();
    const repoDir = join(tmpDir, "normal-clone");
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
  });

  it("succeeds when .git is a file (worktree)", () => {
    const registry = makeRegistry();
    const repoDir = join(tmpDir, "worktree-clone");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
  });

  it("throws when .git is neither a directory nor a regular file (e.g. a FIFO)", () => {
    const registry = makeRegistry();
    const repoDir = join(tmpDir, "weird-git-entry");
    mkdirSync(repoDir, { recursive: true });
    const gitPath = join(repoDir, ".git");
    execFileSync("mkfifo", [gitPath]);

    expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
      /Working directory has invalid \.git entry/,
    );
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

  it("loads a RepoRegistry from an existing config file at configPath", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "realRepo" })], "realRepo");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("realRepo");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 1, defaultRepo: "realRepo" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when configPath is missing but the example exists", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "exampleRepo" })], "exampleRepo");
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("exampleRepo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither configPath nor its .example.json fallback exists", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "missing.config.json");

    expect(() => loadRepoRegistry(configPath, tmpDir, logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a zod validation error when the config file contains invalid data", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry(configPath, tmpDir, logger as never)).toThrow();
  });
});
