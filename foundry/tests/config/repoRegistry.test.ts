import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  describe("constructor", () => {
    it("throws when defaultRepo is not present among the configured repos", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "missing-repo");
      expect(() => new RepoRegistry("/repos", config, makeLogger())).toThrow(
        /Default repo "missing-repo" not found in registry/,
      );
    });

    it("succeeds and exposes the default repo when defaultRepo matches", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry("/repos", config, makeLogger());
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });
  });

  describe("getRepoByName / getRepoByLinearProject", () => {
    it("returns the matching repo entry by name, undefined when absent", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b", directory: "repo-b" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      expect(registry.getRepoByName("repo-b")?.name).toBe("repo-b");
      expect(registry.getRepoByName("nope")).toBeUndefined();
    });

    it("indexes repos by linearProject and returns undefined when unmatched", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", linearProject: "Project X" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      expect(registry.getRepoByLinearProject("Project X")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("Other")).toBeUndefined();
    });

    it("lists all repos", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b", directory: "repo-b" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const config = makeConfig(
        [
          makeRepoEntry({ name: "repo-a", linearProject: "Project X", linearTeam: "TeamX" }),
          makeRepoEntry({ name: "repo-b", directory: "repo-b", linearTeam: "TeamY" }),
        ],
        "repo-b",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      const resolved = registry.resolveForIssue("Project X", "TeamY");
      expect(resolved.name).toBe("repo-a");
    });

    it("falls back to team-based routing when project doesn't match and no project given", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", linearTeam: "TeamX" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      const resolved = registry.resolveForIssue(undefined, "TeamX");
      expect(resolved.name).toBe("repo-a");
    });

    it("throws when a project was provided but unmatched and there is no team fallback", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", linearProject: "Project X" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls through to team match when project is provided but unmatched", () => {
      const config = makeConfig(
        [
          makeRepoEntry({ name: "repo-a", linearProject: "Project X" }),
          makeRepoEntry({ name: "repo-b", directory: "repo-b", linearTeam: "TeamY" }),
        ],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos", config, makeLogger());
      const resolved = registry.resolveForIssue("Unknown Project", "TeamY");
      expect(resolved.name).toBe("repo-b");
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry("/repos", config, makeLogger());
      const resolved = registry.resolveForIssue();
      expect(resolved.name).toBe("repo-a");
    });

    it("falls back to the default repo when team is provided but doesn't match any repo", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry("/repos", config, makeLogger());
      const resolved = registry.resolveForIssue(undefined, "UnknownTeam");
      expect(resolved.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against reposRootPath", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a", directory: "repo-a" })], "repo-a");
      const registry = new RepoRegistry("/repos-root", config, makeLogger());
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "repo-a"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", directory: "/absolute/repo-a" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/repos-root", config, makeLogger());
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/repo-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    let baseDir: string;

    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry(baseDir, config, makeLogger());
      const missing = join(baseDir, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry(baseDir, config, makeLogger());
      const dir = join(baseDir, "no-git");
      mkdirSync(dir);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (normal clone)", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry(baseDir, config, makeLogger());
      const dir = join(baseDir, "normal-clone");
      mkdirSync(dir);
      mkdirSync(join(dir, ".git"));
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (worktree)", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry(baseDir, config, makeLogger());
      const dir = join(baseDir, "worktree-clone");
      mkdirSync(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/foo\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when .git exists but is neither a directory nor a regular file", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry(baseDir, config, makeLogger());
      const dir = join(baseDir, "fifo-git-entry");
      mkdirSync(dir);
      const gitEntryPath = join(dir, ".git");
      // A FIFO is neither a directory nor a regular file, exercising the
      // defensive "invalid .git entry" branch.
      execFileSync("mkfifo", [gitEntryPath]);
      try {
        expect(() => registry.validateWorkingDirectory(dir)).toThrow(
          /Working directory has invalid \.git entry/,
        );
      } finally {
        rmSync(gitEntryPath, { force: true });
      }
    });
  });
});

describe("loadRepoRegistry", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("loads and parses a valid repos.config.json", () => {
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
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
      }),
    );

    const registry = loadRepoRegistry(configPath, baseDir, makeLogger());
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    // defaultBranch has a schema default of "main" when omitted
    expect(registry.getDefaultRepo().defaultBranch).toBe("main");
  });

  it("falls back to the *.example.json file when the primary config is missing", () => {
    const configPath = join(baseDir, "repos.config.json");
    const examplePath = join(baseDir, "repos.config.example.json");
    writeFileSync(
      examplePath,
      JSON.stringify({
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
      }),
    );

    let warned = false;
    const logger = {
      info: () => {},
      warn: () => {
        warned = true;
      },
      error: () => {},
      debug: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const registry = loadRepoRegistry(configPath, baseDir, logger);
    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(warned).toBe(true);
  });

  it("throws when neither the config nor the example fallback exist", () => {
    const configPath = join(baseDir, "nonexistent.config.json");
    expect(() => loadRepoRegistry(configPath, baseDir, makeLogger())).toThrow(
      /Repo config not found/,
    );
  });

  it("throws a zod validation error when the config JSON has an invalid shape", () => {
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "repo-a" }));
    // repos.min(1) fails for an empty array
    expect(() => loadRepoRegistry(configPath, baseDir, makeLogger())).toThrow();
  });
});
