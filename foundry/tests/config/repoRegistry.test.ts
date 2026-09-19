import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

let fakeNonDirectoryPath: string | null = null;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: ((p: Parameters<typeof actual.statSync>[0], ...rest: unknown[]) => {
      if (fakeNonDirectoryPath && p === fakeNonDirectoryPath) {
        return {
          isDirectory: () => false,
          isFile: () => false,
        } as ReturnType<typeof actual.statSync>;
      }
      // @ts-expect-error -- forwarding varargs to the real implementation
      return actual.statSync(p, ...rest);
    }) as typeof actual.statSync,
  };
});

function noopLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/backend",
    directory: "backend",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  afterEach(() => {
    fakeNonDirectoryPath = null;
  });

  it("throws when defaultRepo does not match any configured repo", () => {
    const config = makeConfig([makeRepoEntry({ name: "a" })], "does-not-exist");
    expect(() => new RepoRegistry("/repos", config, noopLogger())).toThrow(
      /Default repo "does-not-exist" not found in registry\. Available: a/,
    );
  });

  describe("getRepoByName / getDefaultRepo", () => {
    it("returns the matching entry, or undefined for an unknown name", () => {
      const entryA = makeRepoEntry({ name: "a" });
      const config = makeConfig([entryA], "a");
      const registry = new RepoRegistry("/repos", config, noopLogger());

      expect(registry.getRepoByName("a")).toBe(entryA);
      expect(registry.getRepoByName("missing")).toBeUndefined();
      expect(registry.getDefaultRepo()).toBe(entryA);
    });
  });

  describe("getRepoByLinearProject", () => {
    it("returns the entry mapped to a linearProject, or undefined otherwise", () => {
      const entryA = makeRepoEntry({ name: "a", linearProject: "Foundry" });
      const config = makeConfig([entryA], "a");
      const registry = new RepoRegistry("/repos", config, noopLogger());

      expect(registry.getRepoByLinearProject("Foundry")).toBe(entryA);
      expect(registry.getRepoByLinearProject("Other")).toBeUndefined();
    });
  });

  describe("listRepos", () => {
    it("returns all configured repo entries", () => {
      const entryA = makeRepoEntry({ name: "a" });
      const entryB = makeRepoEntry({ name: "b" });
      const registry = new RepoRegistry("/repos", makeConfig([entryA, entryB], "a"), noopLogger());
      expect(registry.listRepos()).toEqual(expect.arrayContaining([entryA, entryB]));
      expect(registry.listRepos()).toHaveLength(2);
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const entryA = makeRepoEntry({ name: "a", linearProject: "Foundry" });
      const entryDefault = makeRepoEntry({ name: "default" });
      const logger = noopLogger();
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([entryA, entryDefault], "default"),
        logger,
      );

      const result = registry.resolveForIssue("Foundry", undefined);
      expect(result).toBe(entryA);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ project: "Foundry", repo: "a" }),
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when there is no project match", () => {
      const entryTeam = makeRepoEntry({ name: "a", linearTeam: "ENG", assigneeMe: true });
      const entryDefault = makeRepoEntry({ name: "default" });
      const logger = noopLogger();
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([entryTeam, entryDefault], "default"),
        logger,
      );

      const result = registry.resolveForIssue(undefined, "ENG");
      expect(result).toBe(entryTeam);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ team: "ENG", repo: "a" }),
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given, unmatched, and no team is given", () => {
      const entryA = makeRepoEntry({ name: "a", linearProject: "Foundry" });
      const entryDefault = makeRepoEntry({ name: "default" });
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([entryA, entryDefault], "default"),
        noopLogger(),
      );

      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to default when both project and team are given but neither matches", () => {
      const entryA = makeRepoEntry({ name: "a", linearProject: "Foundry" });
      const entryDefault = makeRepoEntry({ name: "default" });
      const logger = noopLogger();
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([entryA, entryDefault], "default"),
        logger,
      );

      const result = registry.resolveForIssue("Unknown Project", "unknown-team");
      expect(result).toBe(entryDefault);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: "default" }),
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to default when neither project nor team is given", () => {
      const entryDefault = makeRepoEntry({ name: "default" });
      const registry = new RepoRegistry("/repos", makeConfig([entryDefault], "default"), noopLogger());

      expect(registry.resolveForIssue(undefined, undefined)).toBe(entryDefault);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const entry = makeRepoEntry({ directory: "/absolute/path/repo" });
      const registry = new RepoRegistry("/repos-root", makeConfig([entry], "acme/backend"), noopLogger());

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/absolute/path/repo"));
    });

    it("joins a relative directory with the repos root path", () => {
      const entry = makeRepoEntry({ directory: "backend" });
      const registry = new RepoRegistry("/repos-root", makeConfig([entry], "acme/backend"), noopLogger());

      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/repos-root/backend"));
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([makeRepoEntry()], "acme/backend"),
        noopLogger(),
      );
      const missing = join(tmpDir, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([makeRepoEntry()], "acme/backend"),
        noopLogger(),
      );
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a working directory whose .git entry is a real directory (a clone)", () => {
      execFileSync("git", ["init", "--initial-branch", "main"], { cwd: tmpDir });
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([makeRepoEntry()], "acme/backend"),
        noopLogger(),
      );
      expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
      expect(existsSync(join(tmpDir, ".git"))).toBe(true);
    });

    it("accepts a working directory whose .git entry is a file (a worktree)", () => {
      writeFileSync(join(tmpDir, ".git"), "gitdir: /somewhere/.git/worktrees/foo\n");
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([makeRepoEntry()], "acme/backend"),
        noopLogger(),
      );
      expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
    });

    it("throws when the .git entry exists but is neither a directory nor a regular file", () => {
      const gitEntryPath = join(tmpDir, ".git");
      execFileSync("mkfifo", [gitEntryPath]);
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([makeRepoEntry()], "acme/backend"),
        noopLogger(),
      );
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory (defensive check)", () => {
      execFileSync("git", ["init", "--initial-branch", "main"], { cwd: tmpDir });
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([makeRepoEntry()], "acme/backend"),
        noopLogger(),
      );
      // The .git subdirectory is real; only the final statSync(workingDirectory)
      // call is faked to report a non-directory, exercising the defensive
      // final check that real filesystems can never actually trigger (a file
      // cannot have a valid .git child).
      fakeNonDirectoryPath = tmpDir;
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /Working directory path is not a directory/,
      );
    });
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

  function writeConfig(path: string, config: unknown): void {
    writeFileSync(path, JSON.stringify(config, null, 2));
  }

  it("loads a config file that exists at the given path", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeConfig(configPath, makeConfig([makeRepoEntry({ name: "a" })], "a"));
    const logger = noopLogger();

    const registry = loadRepoRegistry(configPath, tmpDir, logger);

    expect(registry.getRepoByName("a")).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the sibling .example.json when the configured path is missing", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    writeConfig(examplePath, makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo"));
    const logger = noopLogger();

    const registry = loadRepoRegistry(configPath, tmpDir, logger);

    expect(registry.getRepoByName("example-repo")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolve(configPath), fallback: resolve(examplePath) }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config file nor its .example.json fallback exist", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const logger = noopLogger();

    expect(() => loadRepoRegistry(configPath, tmpDir, logger)).toThrow(
      /Repo config not found at .* and no example fallback at/,
    );
  });

  it("throws when the config file contains invalid JSON structure per the schema", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "nothing" });
    const logger = noopLogger();

    // repos: [] fails ReposConfigSchema's .min(1) on the repos array.
    expect(() => loadRepoRegistry(configPath, tmpDir, logger)).toThrow();
  });
});
