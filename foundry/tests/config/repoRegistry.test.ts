import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "../../src/utils/logger.js";

// Paths used to simulate filesystem states that cannot occur on a real
// filesystem (e.g. a ".git" entry that is neither a file nor a directory,
// or a "directory" that stat reports as not being a directory even though
// its child ".git" entry resolved successfully). We mock node:fs so these
// two specific paths return crafted stat results while every other call
// passes through to the real filesystem untouched.
const BAD_GIT_ENTRY_DIR = "/fake/repo/bad-git-entry";
const BAD_GIT_ENTRY_GITDIR = join(BAD_GIT_ENTRY_DIR, ".git");
const NOT_A_DIR_WORKDIR = "/fake/repo/not-a-dir";
const NOT_A_DIR_GITDIR = join(NOT_A_DIR_WORKDIR, ".git");

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (p: unknown) => {
      if (p === BAD_GIT_ENTRY_DIR || p === BAD_GIT_ENTRY_GITDIR) return true;
      if (p === NOT_A_DIR_WORKDIR || p === NOT_A_DIR_GITDIR) return true;
      return actual.existsSync(p as never);
    },
    statSync: (p: unknown, ...rest: unknown[]) => {
      if (p === BAD_GIT_ENTRY_GITDIR) {
        return { isDirectory: () => false, isFile: () => false } as ReturnType<
          typeof actual.statSync
        >;
      }
      if (p === NOT_A_DIR_GITDIR) {
        return { isDirectory: () => false, isFile: () => true } as ReturnType<
          typeof actual.statSync
        >;
      }
      if (p === NOT_A_DIR_WORKDIR) {
        return { isDirectory: () => false, isFile: () => false } as ReturnType<
          typeof actual.statSync
        >;
      }
      return (actual.statSync as (...a: unknown[]) => unknown)(p, ...rest);
    },
  };
});

const { RepoRegistry, loadRepoRegistry } = await import("../../src/config/repoRegistry.js");
type ReposConfig = import("../../src/config/repoRegistry.js").ReposConfig;

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function validConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    defaultRepo: "repo-a",
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: ["secrets/"],
        constraints: {
          requiredChecks: ["lint"],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
      {
        name: "repo-b",
        directory: "/abs/path/repo-b",
        linearProject: "proj-b",
        linearTeam: "team-b",
        assigneeMe: true,
        defaultBranch: "develop",
        allowedPaths: [],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 5,
          maxDiffLines: 200,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("indexes repos by name, linearProject, and linearTeam", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
    expect(registry.getRepoByLinearProject("proj-b")?.name).toBe("repo-b");
    expect(registry.getRepoByLinearProject("missing")).toBeUndefined();
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos().map((r) => r.name)).toEqual(["repo-a", "repo-b"]);
  });

  it("throws if defaultRepo is not present among the repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root/workspace", validConfig({ defaultRepo: "nope" }), logger),
    ).toThrow(/Default repo "nope" not found in registry\. Available: repo-a, repo-b/);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      const entry = registry.resolveForIssue("proj-b", undefined);

      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "proj-b", repo: "repo-b" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is unset", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      const entry = registry.resolveForIssue(undefined, "team-b");

      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "team-b", repo: "repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      expect(() => registry.resolveForIssue("unknown-proj", undefined)).toThrow(
        /No repo mapped to Linear project "unknown-proj"\. Configured projects: \[proj-b\]/,
      );
    });

    it("falls back to the default repo when project and team are both unmatched", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      const entry = registry.resolveForIssue("unknown-proj", "unknown-team");

      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      const entry = registry.resolveForIssue();

      expect(entry.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the directory as-is (resolved) when it is absolute", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const entry = registry.getRepoByName("repo-b")!;

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/repo-b"));
    });

    it("joins against reposRootPath when the directory is relative", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const entry = registry.getRepoByName("repo-a")!;

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/root/workspace/repo-a"));
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpDirs: string[] = [];

    function makeTmpDir(): string {
      const dir = mkdtempSync(join(tmpdir(), "repo-registry-"));
      tmpDirs.push(dir);
      return dir;
    }

    afterEach(() => {
      for (const dir of tmpDirs) {
        rmSync(dir, { recursive: true, force: true });
      }
      tmpDirs = [];
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const missing = join(tmpdir(), "repo-registry-does-not-exist-xyz");

      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when there is no .git entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const dir = makeTmpDir();

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a directory (normal clone)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const dir = makeTmpDir();
      mkdirSync(join(dir, ".git"));

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const dir = makeTmpDir();
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when the .git entry is neither a file nor a directory", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      expect(() => registry.validateWorkingDirectory(BAD_GIT_ENTRY_DIR)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);

      expect(() => registry.validateWorkingDirectory(NOT_A_DIR_WORKDIR)).toThrow(
        /Working directory path is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  it("loads and parses a valid config file", () => {
    const dir = makeTmpDir();
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(validConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/root/workspace", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos()).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: resolve(configPath),
        repoCount: 2,
        defaultRepo: "repo-a",
      }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the primary config is missing", () => {
    const dir = makeTmpDir();
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(validConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/root/workspace", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: resolve(configPath),
        fallback: resolve(examplePath),
      }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config file nor the example fallback exists", () => {
    const dir = makeTmpDir();
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/root/workspace", logger)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a schema validation error for a malformed config file", () => {
    const dir = makeTmpDir();
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [] }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/root/workspace", logger)).toThrow();
  });
});
