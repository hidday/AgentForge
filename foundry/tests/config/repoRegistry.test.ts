import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    name: "backend",
    directory: "backend",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
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
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("throws when the default repo is not present among the configured repos", () => {
    const config: ReposConfig = { repos: [makeRepoEntry()], defaultRepo: "missing" };
    expect(() => new RepoRegistry("/root", config, logger as never)).toThrow(
      /Default repo "missing" not found in registry/,
    );
  });

  it("getRepoByName returns the entry or undefined", () => {
    const backend = makeRepoEntry();
    const registry = new RepoRegistry(
      "/root",
      { repos: [backend], defaultRepo: "backend" },
      logger as never,
    );
    expect(registry.getRepoByName("backend")).toBe(backend);
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const backend = makeRepoEntry();
    const registry = new RepoRegistry(
      "/root",
      { repos: [backend], defaultRepo: "backend" },
      logger as never,
    );
    expect(registry.getDefaultRepo()).toBe(backend);
  });

  it("listRepos returns all configured entries", () => {
    const backend = makeRepoEntry();
    const frontend = makeRepoEntry({ name: "frontend", directory: "frontend" });
    const registry = new RepoRegistry(
      "/root",
      { repos: [backend, frontend], defaultRepo: "backend" },
      logger as never,
    );
    expect(registry.listRepos()).toEqual([backend, frontend]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const backend = makeRepoEntry({ linearProject: "Backend Platform" });
      const registry = new RepoRegistry(
        "/root",
        { repos: [backend], defaultRepo: "backend" },
        logger as never,
      );
      expect(registry.resolveForIssue("Backend Platform")).toBe(backend);
    });

    it("falls back to team-based routing when project does not match but no project was given", () => {
      const backend = makeRepoEntry({ linearTeam: "Platform" });
      const registry = new RepoRegistry(
        "/root",
        { repos: [backend], defaultRepo: "backend" },
        logger as never,
      );
      expect(registry.resolveForIssue(undefined, "Platform")).toBe(backend);
    });

    it("throws when a project was given but has no mapping and there is no team fallback", () => {
      const backend = makeRepoEntry({ linearProject: "Backend Platform" });
      const registry = new RepoRegistry(
        "/root",
        { repos: [backend], defaultRepo: "backend" },
        logger as never,
      );
      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const backend = makeRepoEntry();
      const registry = new RepoRegistry(
        "/root",
        { repos: [backend], defaultRepo: "backend" },
        logger as never,
      );
      expect(registry.resolveForIssue()).toBe(backend);
    });

    it("falls back to the default repo when project is unmatched but a team is also given with no match", () => {
      const backend = makeRepoEntry();
      const registry = new RepoRegistry(
        "/root",
        { repos: [backend], defaultRepo: "backend" },
        logger as never,
      );
      expect(registry.resolveForIssue("Unknown Project", "Unknown Team")).toBe(backend);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns an absolute directory as-is (resolved)", () => {
      const registry = new RepoRegistry(
        "/root",
        { repos: [makeRepoEntry()], defaultRepo: "backend" },
        logger as never,
      );
      const entry = makeRepoEntry({ directory: "/abs/path" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path");
    });

    it("joins a relative directory with the repos root path", () => {
      const registry = new RepoRegistry(
        "/root",
        { repos: [makeRepoEntry()], defaultRepo: "backend" },
        logger as never,
      );
      const entry = makeRepoEntry({ directory: "backend" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/root/backend");
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const registry = () =>
      new RepoRegistry(
        "/root",
        { repos: [makeRepoEntry()], defaultRepo: "backend" },
        makeLogger() as never,
      );

    it("throws when the working directory does not exist", () => {
      expect(() => registry().validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory has no .git entry", () => {
      expect(() => registry().validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a directory with a .git directory (normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      expect(() => registry().validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a directory with a .git file (worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/x");
      expect(() => registry().validateWorkingDirectory(dir)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    logger = makeLogger();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const config = {
    repos: [
      {
        name: "backend",
        directory: "backend",
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
    defaultRepo: "backend",
  };

  it("loads and parses a valid config file", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getRepoByName("backend")?.defaultBranch).toBe("main");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "backend" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the configured path is missing, with a warning", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getRepoByName("backend")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the config nor its example fallback exists", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON structure", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [] }));
    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });
});
