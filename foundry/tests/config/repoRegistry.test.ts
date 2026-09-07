import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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

describe("RepoRegistry", () => {
  describe("constructor", () => {
    it("throws when defaultRepo does not name a configured repo", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "does-not-exist",
      };

      expect(() => new RepoRegistry("/repos", config, logger as never)).toThrow(
        /Default repo "does-not-exist" not found in registry. Available: repo-a/,
      );
    });

    it("builds project and team indexes only from entries that declare them", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-a", linearProject: "Proj A" }),
          makeRepoEntry({ name: "repo-b", linearTeam: "Team B", assigneeMe: true }),
          makeRepoEntry({ name: "repo-c" }),
        ],
        defaultRepo: "repo-c",
      };
      const registry = new RepoRegistry("/repos", config, logger as never);

      expect(registry.getRepoByLinearProject("Proj A")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
    });
  });

  describe("getRepoByName / getDefaultRepo / listRepos", () => {
    const logger = makeLogger();
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
      defaultRepo: "repo-a",
    };
    const registry = new RepoRegistry("/repos", config, logger as never);

    it("returns the entry by name", () => {
      expect(registry.getRepoByName("repo-b")?.name).toBe("repo-b");
    });

    it("returns undefined for an unknown name", () => {
      expect(registry.getRepoByName("missing")).toBeUndefined();
    });

    it("returns the default repo entry", () => {
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });

    it("lists all configured repos", () => {
      expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-a", linearProject: "Proj A", linearTeam: "Team A" }),
          makeRepoEntry({ name: "repo-b" }),
        ],
        defaultRepo: "repo-b",
      };
      const registry = new RepoRegistry("/repos", config, logger as never);

      const entry = registry.resolveForIssue("Proj A", "Team A");

      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Proj A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project doesn't match", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-a", linearTeam: "Team A", assigneeMe: true }),
          makeRepoEntry({ name: "repo-b" }),
        ],
        defaultRepo: "repo-b",
      };
      const registry = new RepoRegistry("/repos", config, logger as never);

      const entry = registry.resolveForIssue(undefined, "Team A");

      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team A", repo: "repo-a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is provided, unmatched, and no team fallback is given", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a", linearProject: "Proj A" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/repos", config, logger as never);

      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also provided and unmatched", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a", linearProject: "Proj A" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/repos", config, logger as never);

      const entry = registry.resolveForIssue("Unknown Project", "Unknown Team");

      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const logger = makeLogger();
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/repos", config, logger as never);

      expect(registry.resolveForIssue().name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    const logger = makeLogger();
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    };
    const registry = new RepoRegistry("/repos-root", config, logger as never);

    it("resolves a relative directory against the repos root path", () => {
      const entry = makeRepoEntry({ directory: "sub/repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "sub/repo"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const entry = makeRepoEntry({ directory: "/absolute/path/repo" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/path/repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let base: string;
    const logger = makeLogger();
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    };
    const registry = new RepoRegistry("/repos-root", config, logger as never);

    beforeEach(() => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(base, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const missing = join(base, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      expect(() => registry.validateWorkingDirectory(base)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a real directory (normal clone)", () => {
      mkdirSync(join(base, ".git"));
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      writeFileSync(join(base, ".git"), "gitdir: /somewhere/else\n");
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("throws when the working directory path is a file, not a directory", () => {
      // .git as a directory so we get past that check, but the "working directory"
      // we pass in is itself a file.
      const filePath = join(base, "not-a-dir.txt");
      writeFileSync(filePath, "hi");
      // Give the parent-of-filePath check something to find under filePath -- impossible
      // since filePath is a file, so existsSync(join(filePath, ".git")) is false and we'd
      // hit the "not a git repository" branch instead. To reach the final branch we need
      // .git to exist as a sibling entry path that resolves under the file, which isn't
      // possible on a real filesystem, so we instead assert the git-repository branch
      // fires correctly for a file working directory.
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /Working directory is not a git repository/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "load-repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: unknown) {
    writeFileSync(path, JSON.stringify(config), "utf-8");
  }

  it("loads and parses a valid repos.config.json, applying the defaultBranch default", () => {
    const logger = makeLogger();
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, {
      repos: [
        {
          name: "repo-a",
          directory: "repo-a",
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
      defaultRepo: "repo-a",
    });

    const registry = loadRepoRegistry(configPath, "/repos-root", logger as never);

    expect(registry.getRepoByName("repo-a")?.defaultBranch).toBe("main");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the primary config is missing", () => {
    const logger = makeLogger();
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, {
      repos: [
        {
          name: "example-repo",
          directory: "example-repo",
          allowedPaths: [],
          protectedPaths: [],
          constraints: {
            requiredChecks: [],
            maxFilesChanged: 5,
            maxDiffLines: 100,
            forbiddenPatterns: [],
            mustNotTouch: [],
          },
        },
      ],
      defaultRepo: "example-repo",
    });
    expect(existsSync(configPath)).toBe(false);

    const registry = loadRepoRegistry(configPath, "/repos-root", logger as never);

    expect(registry.getRepoByName("example-repo")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config nor its example fallback exist", () => {
    const logger = makeLogger();
    const configPath = join(dir, "missing.config.json");

    expect(() => loadRepoRegistry(configPath, "/repos-root", logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws (via zod) when the config file contains invalid data", () => {
    const logger = makeLogger();
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "repo-a" });

    expect(() => loadRepoRegistry(configPath, "/repos-root", logger as never)).toThrow();
  });
});
