import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: vi.fn(actual.statSync),
  };
});

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a-dir",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
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

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  it("throws when defaultRepo does not match any configured repo name", () => {
    const logger = makeLogger();
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "nonexistent-repo");

    expect(() => new RepoRegistry("/root", config, logger)).toThrow(
      /Default repo "nonexistent-repo" not found in registry\. Available: repo-a/,
    );
  });

  describe("getRepoByName / getDefaultRepo / listRepos", () => {
    it("returns entries by name, undefined for unknown names, and lists all entries", () => {
      const logger = makeLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const repoB = makeRepoEntry({ name: "repo-b", directory: "repo-b-dir" });
      const registry = new RepoRegistry("/root", makeConfig([repoA, repoB], "repo-a"), logger);

      expect(registry.getRepoByName("repo-a")).toEqual(repoA);
      expect(registry.getRepoByName("repo-b")).toEqual(repoB);
      expect(registry.getRepoByName("missing")).toBeUndefined();
      expect(registry.getDefaultRepo()).toEqual(repoA);
      expect(registry.listRepos()).toHaveLength(2);
      expect(registry.listRepos()).toEqual(expect.arrayContaining([repoA, repoB]));
    });
  });

  describe("getRepoByLinearProject", () => {
    it("returns the matching entry and undefined for a project with no mapping", () => {
      const logger = makeLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "ProjA" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger);

      expect(registry.getRepoByLinearProject("ProjA")).toEqual(repoA);
      expect(registry.getRepoByLinearProject("ProjB")).toBeUndefined();
    });
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const logger = makeLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "ProjA" });
      const repoB = makeRepoEntry({
        name: "repo-b",
        directory: "repo-b-dir",
        linearTeam: "TeamB",
        assigneeMe: true,
      });
      const defaultRepo = makeRepoEntry({ name: "repo-default", directory: "default-dir" });
      const registry = new RepoRegistry(
        "/root",
        makeConfig([repoA, repoB, defaultRepo], "repo-default"),
        logger,
      );
      return { registry, repoA, repoB, defaultRepo, logger };
    }

    it("resolves by exact Linear project match first", () => {
      const { registry, repoA, logger } = buildRegistry();

      const result = registry.resolveForIssue("ProjA", "TeamB");

      expect(result).toEqual(repoA);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "ProjA", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("resolves by team when no project is given", () => {
      const { registry, repoB } = buildRegistry();

      const result = registry.resolveForIssue(undefined, "TeamB");

      expect(result).toEqual(repoB);
    });

    it("falls back to team match when project is provided but does not match any repo", () => {
      const { registry, repoB } = buildRegistry();

      const result = registry.resolveForIssue("UnknownProject", "TeamB");

      expect(result).toEqual(repoB);
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const { registry } = buildRegistry();

      expect(() => registry.resolveForIssue("UnknownProject", undefined)).toThrow(
        /No repo mapped to Linear project "UnknownProject"/,
      );
    });

    it("falls back to the default repo when project and team are both provided but unmatched", () => {
      const { registry, defaultRepo, logger } = buildRegistry();

      const result = registry.resolveForIssue("UnknownProject", "UnknownTeam");

      expect(result).toEqual(defaultRepo);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-default" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const { registry, defaultRepo } = buildRegistry();

      const result = registry.resolveForIssue();

      expect(result).toEqual(defaultRepo);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute entry.directory as-is", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "repo-a", directory: "/abs/repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([entry], "repo-a"), logger);

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/repo-a"));
    });

    it("joins a relative entry.directory onto the reposRootPath", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "repo-a", directory: "relative-dir" });
      const registry = new RepoRegistry("/root/repos", makeConfig([entry], "repo-a"), logger);

      expect(registry.resolveWorkingDirectory(entry)).toBe(
        resolve(join("/root/repos", "relative-dir")),
      );
    });
  });

  describe("validateWorkingDirectory", () => {
    let base: string;
    let registry: RepoRegistry;

    beforeEach(() => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      const logger = makeLogger();
      registry = new RepoRegistry(base, makeConfig([makeRepoEntry()], "repo-a"), logger);
    });

    afterEach(() => {
      rmSync(base, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("throws when the working directory does not exist", () => {
      const missing = join(base, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory exists but has no .git entry", () => {
      const dir = join(base, "no-git");
      mkdirSync(dir);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a directory (a normal clone)", () => {
      const dir = join(base, "normal-clone");
      mkdirSync(join(dir, ".git"), { recursive: true });
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a file (a worktree)", () => {
      const dir = join(base, "worktree");
      mkdirSync(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /some/other/path\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when the .git entry is neither a file nor a directory (defensive branch)", async () => {
      const dir = join(base, "weird-git");
      mkdirSync(join(dir, ".git"), { recursive: true });
      const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
      const fakeStat = { isDirectory: () => false, isFile: () => false } as Stats;
      vi.mocked(statSync)
        .mockImplementationOnce(() => fakeStat)
        .mockImplementation(actualFs.statSync);

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory (defensive branch)", async () => {
      const dir = join(base, "not-a-dir");
      mkdirSync(join(dir, ".git"), { recursive: true });
      const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
      const fakeStat = { isDirectory: () => false, isFile: () => false } as Stats;
      vi.mocked(statSync)
        .mockImplementationOnce(actualFs.statSync)
        .mockImplementationOnce(() => fakeStat)
        .mockImplementation(actualFs.statSync);

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory path is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("loads the registry directly from configPath when it exists", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const registry = loadRepoRegistry(configPath, base, logger);

    expect(registry.getRepoByName("repo-a")).toBeDefined();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: resolve(configPath), repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file and warns when configPath is missing", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    const examplePath = join(base, "repos.config.example.json");
    const config = makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo");
    writeFileSync(examplePath, JSON.stringify(config), "utf-8");

    const registry = loadRepoRegistry(configPath, base, logger);

    expect(registry.getRepoByName("example-repo")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolve(configPath), fallback: resolve(examplePath) }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither configPath nor the example fallback exists", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, base, logger)).toThrow(
      /Repo config not found at .* and no example fallback at/,
    );
  });

  it("throws a Zod validation error when the config file content is schema-invalid", () => {
    const logger = makeLogger();
    const configPath = join(base, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }), "utf-8");

    expect(() => loadRepoRegistry(configPath, base, logger)).toThrow();
  });
});
