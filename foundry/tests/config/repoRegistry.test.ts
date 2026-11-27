import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only `statSync` is wrapped (delegating to the real implementation by
// default); every other `node:fs` export stays untouched. This lets one test
// below simulate a stat result that is otherwise impossible to produce on a
// real filesystem (see "defensive check").
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn(actual.statSync) };
});
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
      maxDiffLines: 1000,
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
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("throws when the default repo is not present among the configured repos", () => {
    const config = makeConfig([makeRepoEntry({ name: "a" })], "does-not-exist");
    expect(() => new RepoRegistry("/root", config, logger as never)).toThrow(
      /Default repo "does-not-exist" not found in registry. Available: a/,
    );
  });

  it("getRepoByName and getDefaultRepo return the configured entries", () => {
    const a = makeRepoEntry({ name: "a" });
    const b = makeRepoEntry({ name: "b" });
    const registry = new RepoRegistry("/root", makeConfig([a, b], "b"), logger as never);

    expect(registry.getRepoByName("a")).toEqual(a);
    expect(registry.getRepoByName("missing")).toBeUndefined();
    expect(registry.getDefaultRepo()).toEqual(b);
  });

  it("getRepoByLinearProject looks up by the configured linearProject name", () => {
    const a = makeRepoEntry({ name: "a", linearProject: "Project A" });
    const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger as never);

    expect(registry.getRepoByLinearProject("Project A")).toEqual(a);
    expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
  });

  it("listRepos returns all configured repo entries", () => {
    const a = makeRepoEntry({ name: "a" });
    const b = makeRepoEntry({ name: "b" });
    const registry = new RepoRegistry("/root", makeConfig([a, b], "a"), logger as never);

    expect(registry.listRepos()).toEqual([a, b]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact linear project match", () => {
      const a = makeRepoEntry({ name: "a", linearProject: "Project A" });
      const def = makeRepoEntry({ name: "def" });
      const registry = new RepoRegistry("/root", makeConfig([a, def], "def"), logger as never);

      expect(registry.resolveForIssue("Project A")).toEqual(a);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "a" },
        "Resolved repo from Linear project",
      );
    });

    it("resolves by team when no project is given", () => {
      const b = makeRepoEntry({ name: "b", linearTeam: "TeamB", assigneeMe: true });
      const def = makeRepoEntry({ name: "def" });
      const registry = new RepoRegistry("/root", makeConfig([b, def], "def"), logger as never);

      expect(registry.resolveForIssue(undefined, "TeamB")).toEqual(b);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "TeamB", repo: "b" },
        "Resolved repo from Linear team",
      );
    });

    it("prefers project match over team match when both are given", () => {
      const a = makeRepoEntry({ name: "a", linearProject: "Project A" });
      const b = makeRepoEntry({ name: "b", linearTeam: "TeamB" });
      const registry = new RepoRegistry("/root", makeConfig([a, b], "a"), logger as never);

      expect(registry.resolveForIssue("Project A", "TeamB")).toEqual(a);
    });

    it("throws when a project is given, unmatched, and no team is provided", () => {
      const a = makeRepoEntry({ name: "a", linearProject: "Project A" });
      const registry = new RepoRegistry("/root", makeConfig([a], "a"), logger as never);

      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team was also provided (even if also unmatched)", () => {
      const a = makeRepoEntry({ name: "a", linearProject: "Project A" });
      const def = makeRepoEntry({ name: "def" });
      const registry = new RepoRegistry("/root", makeConfig([a, def], "def"), logger as never);

      expect(registry.resolveForIssue("Unknown Project", "UnknownTeam")).toEqual(def);
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const def = makeRepoEntry({ name: "def" });
      const registry = new RepoRegistry("/root", makeConfig([def], "def"), logger as never);

      expect(registry.resolveForIssue()).toEqual(def);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "def" },
        "Issue has no Linear project or team match, using default repo",
      );
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const a = makeRepoEntry({ name: "a", directory: "sub/dir" });
      const registry = new RepoRegistry("/root/repos", makeConfig([a], "a"), logger as never);

      expect(registry.resolveWorkingDirectory(a)).toBe(join("/root/repos", "sub/dir"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const a = makeRepoEntry({ name: "a", directory: "/abs/path/repo" });
      const registry = new RepoRegistry("/root/repos", makeConfig([a], "a"), logger as never);

      expect(registry.resolveWorkingDirectory(a)).toBe("/abs/path/repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let baseDir: string;
    let registry: RepoRegistry;

    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      registry = new RepoRegistry(
        "/root",
        makeConfig([makeRepoEntry({ name: "a" })], "a"),
        logger as never,
      );
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
      expect(() => registry.validateWorkingDirectory(baseDir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a directory (a normal clone)", () => {
      mkdirSync(join(baseDir, ".git"));
      expect(() => registry.validateWorkingDirectory(baseDir)).not.toThrow();
    });

    it("passes when .git is a file (a worktree)", () => {
      writeFileSync(join(baseDir, ".git"), "gitdir: /some/other/path\n");
      expect(() => registry.validateWorkingDirectory(baseDir)).not.toThrow();
    });

    it("throws when .git exists but is neither a file nor a directory (e.g. a FIFO)", () => {
      const gitPath = join(baseDir, ".git");
      try {
        execFileSync("mkfifo", [gitPath]);
      } catch {
        // mkfifo unavailable on this platform -- skip, nothing else to assert.
        return;
      }
      expect(() => registry.validateWorkingDirectory(baseDir)).toThrow(
        /Working directory has invalid .git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory (defensive check)", () => {
      // This path is unreachable through a real filesystem: anything with a
      // ".git" child that exists and passes the prior check is necessarily a
      // directory itself. We simulate it by making the second statSync call
      // (for `workingDirectory`, after the `.git` entry check) report a
      // non-directory stat, to exercise this defensive guard.
      mkdirSync(join(baseDir, ".git"));
      const mockedStatSync = vi.mocked(statSync);
      const realImpl = mockedStatSync.getMockImplementation();
      mockedStatSync.mockImplementation((path: Parameters<typeof statSync>[0], ...rest) => {
        if (path === baseDir) {
          return { isDirectory: () => false, isFile: () => false } as ReturnType<typeof statSync>;
        }
        return realImpl!(path, ...(rest as []));
      });

      try {
        expect(() => registry.validateWorkingDirectory(baseDir)).toThrow(
          `Working directory path is not a directory: ${baseDir}.`,
        );
      } finally {
        mockedStatSync.mockImplementation(realImpl!);
      }
    });
  });
});

describe("loadRepoRegistry", () => {
  let baseDir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "load-repo-registry-test-"));
    logger = makeLogger();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: unknown): void {
    writeFileSync(path, JSON.stringify(config));
  }

  it("loads the config directly when the configured path exists", () => {
    const configPath = join(baseDir, "repos.config.json");
    writeConfig(configPath, makeConfig([makeRepoEntry({ name: "a" })], "a"));

    const registry = loadRepoRegistry(configPath, baseDir, logger as never);

    expect(registry.getRepoByName("a")?.name).toBe("a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 1, defaultRepo: "a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const configPath = join(baseDir, "repos.config.json");
    const examplePath = join(baseDir, "repos.config.example.json");
    writeConfig(examplePath, makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo"));

    const registry = loadRepoRegistry(configPath, baseDir, logger as never);

    expect(registry.getRepoByName("example-repo")?.name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor the example fallback exist", () => {
    const configPath = join(baseDir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, baseDir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws a zod validation error when the config file is structurally invalid", () => {
    const configPath = join(baseDir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "x" });

    expect(() => loadRepoRegistry(configPath, baseDir, logger as never)).toThrow();
  });
});
