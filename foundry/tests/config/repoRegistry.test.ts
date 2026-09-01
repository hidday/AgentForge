import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
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
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function makeConstraints() {
  return {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  describe("constructor", () => {
    it("throws when defaultRepo does not match any configured repo", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "does-not-exist",
      };
      expect(() => new RepoRegistry("/repos", config, makeLogger() as never)).toThrow(
        /Default repo "does-not-exist" not found in registry\. Available: repo-a/,
      );
    });

    it("constructs successfully when defaultRepo matches a configured repo", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/repos", config, makeLogger() as never);
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });
  });

  describe("getRepoByName / getRepoByLinearProject / getDefaultRepo", () => {
    const config: ReposConfig = {
      repos: [
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b" }),
      ],
      defaultRepo: "repo-b",
    };
    const registry = new RepoRegistry("/repos", config, makeLogger() as never);

    it("returns the matching entry by name", () => {
      expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    });

    it("returns undefined for an unknown name", () => {
      expect(registry.getRepoByName("nope")).toBeUndefined();
    });

    it("returns the matching entry by Linear project", () => {
      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    });

    it("returns undefined for an unknown Linear project", () => {
      expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
    });

    it("returns the configured default repo", () => {
      expect(registry.getDefaultRepo().name).toBe("repo-b");
    });
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-project", linearProject: "Project A" }),
          makeRepoEntry({ name: "repo-team", linearTeam: "TeamB", assigneeMe: true }),
          makeRepoEntry({ name: "repo-default" }),
        ],
        defaultRepo: "repo-default",
      };
      return new RepoRegistry("/repos", config, makeLogger() as never);
    }

    it("resolves by exact Linear project match", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue("Project A", undefined).name).toBe("repo-project");
    });

    it("prefers project match over team match when both are provided and both match", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue("Project A", "TeamB").name).toBe("repo-project");
    });

    it("falls back to team match when project is absent", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue(undefined, "TeamB").name).toBe("repo-team");
    });

    it("falls back to team match when project is provided but unmatched and team matches", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue("Unknown Project", "TeamB").name).toBe("repo-team");
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const registry = buildRegistry();
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched and team is also unmatched", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue("Unknown Project", "Unknown Team").name).toBe(
        "repo-default",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue().name).toBe("repo-default");
    });
  });

  describe("resolveWorkingDirectory", () => {
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    };
    const registry = new RepoRegistry("/repos-root", config, makeLogger() as never);

    it("resolves a relative directory against reposRootPath", () => {
      const entry = makeRepoEntry({ name: "repo-a", directory: "repo-a" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "repo-a"));
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const entry = makeRepoEntry({ name: "repo-a", directory: "/absolute/path/repo-a" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/path/repo-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    let baseDir: string;
    let registry: RepoRegistry;

    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "reporegistry-test-"));
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      registry = new RepoRegistry(baseDir, config, makeLogger() as never);
    });

    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const missing = join(baseDir, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory exists but has no .git entry", () => {
      const dir = join(baseDir, "no-git");
      mkdirSync(dir);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (normal clone)", () => {
      const dir = join(baseDir, "normal-clone");
      mkdirSync(dir);
      mkdirSync(join(dir, ".git"));
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (worktree)", () => {
      const dir = join(baseDir, "worktree-clone");
      mkdirSync(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when .git exists but is neither a file nor a directory", () => {
      const dir = join(baseDir, "weird-git");
      mkdirSync(dir);
      const gitPath = join(dir, ".git");
      execFileSync("mkfifo", [gitPath]);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });
  });

  describe("listRepos", () => {
    it("returns all configured repo entries", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/repos", config, makeLogger() as never);
      expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reporegistry-load-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: unknown): void {
    writeFileSync(path, JSON.stringify(config), "utf-8");
  }

  it("loads a valid config file directly", () => {
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    });

    const registry = loadRepoRegistry(configPath, dir, makeLogger() as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos()).toHaveLength(1);
  });

  it("applies the zod default for defaultBranch when omitted", () => {
    const configPath = join(dir, "repos.config.json");
    const entry = makeRepoEntry({ name: "repo-a" });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBranch: _omit, ...withoutDefaultBranch } = entry;
    writeConfig(configPath, {
      repos: [withoutDefaultBranch],
      defaultRepo: "repo-a",
    });

    const registry = loadRepoRegistry(configPath, dir, makeLogger() as never);
    expect(registry.getRepoByName("repo-a")?.defaultBranch).toBe("main");
  });

  it("falls back to the .example.json file when the primary config is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, {
      repos: [makeRepoEntry({ name: "example-repo" })],
      defaultRepo: "example-repo",
    });

    let warned = false;
    const logger = {
      info: () => {},
      warn: () => {
        warned = true;
      },
      error: () => {},
      debug: () => {},
    };

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(warned).toBe(true);
  });

  it("throws when the config is missing and no example fallback exists", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, dir, makeLogger() as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws when the config file contains malformed JSON", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, "{ not valid json", "utf-8");
    expect(() => loadRepoRegistry(configPath, dir, makeLogger() as never)).toThrow();
  });

  it("throws when the config fails schema validation (empty repos array)", () => {
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "repo-a" });
    expect(() => loadRepoRegistry(configPath, dir, makeLogger() as never)).toThrow();
  });

  it("throws when a repo entry is missing required constraint fields", () => {
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, {
      repos: [
        {
          name: "repo-a",
          directory: "repo-a",
          allowedPaths: [],
          protectedPaths: [],
          constraints: { requiredChecks: [] }, // missing maxFilesChanged etc.
        },
      ],
      defaultRepo: "repo-a",
    });
    expect(() => loadRepoRegistry(configPath, dir, makeLogger() as never)).toThrow();
  });

  it("resolves a relative configPath argument", () => {
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    });

    const registry = loadRepoRegistry(configPath, dir, makeLogger() as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });
});
