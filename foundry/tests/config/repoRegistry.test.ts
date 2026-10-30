import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
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

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  it("throws if the default repo isn't among the configured repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig([makeEntry({ name: "a" })], "missing"), logger),
    ).toThrow(/Default repo "missing" not found/);
  });

  it("looks up repos by name and falls back to the default repo", () => {
    const logger = makeLogger();
    const a = makeEntry({ name: "a" });
    const b = makeEntry({ name: "b" });
    const registry = new RepoRegistry("/root", makeConfig([a, b], "a"), logger);

    expect(registry.getRepoByName("b")).toBe(b);
    expect(registry.getRepoByName("missing")).toBeUndefined();
    expect(registry.getDefaultRepo()).toBe(a);
    expect(registry.listRepos()).toEqual([a, b]);
  });

  it("looks up repos by Linear project", () => {
    const logger = makeLogger();
    const a = makeEntry({ name: "a", linearProject: "Platform" });
    const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger);

    expect(registry.getRepoByLinearProject("Platform")).toBe(a);
    expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const a = makeEntry({ name: "a", linearProject: "Platform" });
      const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger);

      expect(registry.resolveForIssue("Platform")).toBe(a);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Platform", repo: "a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when the project doesn't match", () => {
      const logger = makeLogger();
      const a = makeEntry({ name: "a", linearTeam: "Backend", assigneeMe: true });
      const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger);

      expect(registry.resolveForIssue("Unmatched Project", "Backend")).toBe(a);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Backend", repo: "a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given, unmatched, and there is no team fallback", () => {
      const logger = makeLogger();
      const a = makeEntry({ name: "a", linearProject: "Platform" });
      const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger);

      expect(() => registry.resolveForIssue("Other Project")).toThrow(
        /No repo mapped to Linear project "Other Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const a = makeEntry({ name: "a" });
      const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger);

      expect(registry.resolveForIssue()).toBe(a);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when a team is given but unmatched and no project was given", () => {
      const logger = makeLogger();
      const a = makeEntry({ name: "a" });
      const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger);

      expect(registry.resolveForIssue(undefined, "Unmatched Team")).toBe(a);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      const entry = makeEntry({ directory: "/abs/path/repo" });

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/repo"));
    });

    it("joins a relative directory under reposRootPath", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      const entry = makeEntry({ directory: "repo-a" });

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve(join("/root", "repo-a")));
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

    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when .git is missing", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /is not a git repository/,
      );
    });

    it("accepts a .git directory (normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a .git file (worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/foo\n");
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when .git exists but is neither a file nor a directory", () => {
      const gitPath = join(dir, ".git");
      const server = createServer();
      server.listen(gitPath);
      try {
        const logger = makeLogger();
        const registry = new RepoRegistry("/root", makeConfig([makeEntry()], "repo-a"), logger);
        expect(() => registry.validateWorkingDirectory(dir)).toThrow(
          /invalid \.git entry/,
        );
      } finally {
        server.close();
      }
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: ReposConfig) {
    writeFileSync(path, JSON.stringify(config));
  }

  it("loads a config from the given path", () => {
    const logger = makeLogger();
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, makeConfig([makeEntry({ name: "a" })], "a"));

    const registry = loadRepoRegistry(configPath, dir, logger);
    expect(registry.getRepoByName("a")).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the configured path is missing", () => {
    const logger = makeLogger();
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, makeConfig([makeEntry({ name: "example-repo" })], "example-repo"));

    const registry = loadRepoRegistry(configPath, dir, logger);
    expect(registry.getRepoByName("example-repo")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when both the configured path and the example fallback are missing", () => {
    const logger = makeLogger();
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, dir, logger)).toThrow(
      /Repo config not found/,
    );
  });
});
