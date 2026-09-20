import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Wrap `existsSync`/`statSync` as spies (delegating to the real implementation
// by default) so the two filesystem edge cases below -- a `.git` entry that is
// neither a file nor a directory, and a working directory that itself is not
// a directory -- can be exercised without those states existing on a real
// disk. Every other test in this file relies on the real, pass-through
// behavior for all `node:fs` functions, including the ones used here to set
// up and tear down temp directories.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync),
  };
});

const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
import { join, resolve } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
  type RepoConstraints,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function makeConstraints(overrides: Partial<RepoConstraints> = {}): RepoConstraints {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 30,
    maxDiffLines: 2000,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

function makeRepo(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "org/repoA",
    directory: "repoA",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: makeConstraints(),
    ...overrides,
  };
}

const repoA = makeRepo({ name: "org/repoA", directory: "repoA", linearProject: "ProjA" });
const repoB = makeRepo({
  name: "org/repoB",
  directory: "repoB",
  linearTeam: "TeamB",
  assigneeMe: true,
});

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [repoA, repoB],
    defaultRepo: "org/repoA",
    ...overrides,
  };
}

describe("RepoRegistry constructor", () => {
  it("throws when defaultRepo is not present among the repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/repos", makeConfig({ defaultRepo: "org/missing" }), logger),
    ).toThrow(/Default repo "org\/missing" not found in registry/);
  });
});

describe("RepoRegistry lookups", () => {
  const logger = makeLogger();
  const registry = new RepoRegistry("/repos", makeConfig(), logger);

  it("getRepoByName returns the matching entry", () => {
    expect(registry.getRepoByName("org/repoA")).toBe(repoA);
  });

  it("getRepoByName returns undefined for an unknown name", () => {
    expect(registry.getRepoByName("org/nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry", () => {
    expect(registry.getRepoByLinearProject("ProjA")).toBe(repoA);
  });

  it("getRepoByLinearProject returns undefined when no repo declares that project", () => {
    expect(registry.getRepoByLinearProject("Unmapped")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    expect(registry.getDefaultRepo()).toBe(repoA);
  });

  it("listRepos returns every configured repo", () => {
    expect(registry.listRepos()).toEqual([repoA, repoB]);
  });
});

describe("RepoRegistry.resolveForIssue", () => {
  it("resolves by exact Linear project match and logs the resolution", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);

    expect(registry.resolveForIssue("ProjA", undefined)).toBe(repoA);
    expect(logger.debug).toHaveBeenCalledWith(
      { project: "ProjA", repo: "org/repoA" },
      "Resolved repo from Linear project",
    );
  });

  it("falls back to team-based routing when no project is given", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);

    expect(registry.resolveForIssue(undefined, "TeamB")).toBe(repoB);
    expect(logger.debug).toHaveBeenCalledWith(
      { team: "TeamB", repo: "org/repoB" },
      "Resolved repo from Linear team",
    );
  });

  it("falls back to team-based routing when the project does not match", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);

    expect(registry.resolveForIssue("Unmapped", "TeamB")).toBe(repoB);
  });

  it("throws when a project is given, unmatched, and no team is provided", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);

    expect(() => registry.resolveForIssue("Unmapped", undefined)).toThrow(
      /No repo mapped to Linear project "Unmapped"/,
    );
    expect(() => registry.resolveForIssue("Unmapped", undefined)).toThrow(/ProjA/);
  });

  it("falls back to the default repo when project and team are both unmatched", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);

    expect(registry.resolveForIssue("Unmapped", "UnmappedTeam")).toBe(repoA);
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "org/repoA" },
      "Issue has no Linear project or team match, using default repo",
    );
  });

  it("falls back to the default repo when neither project nor team is given", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/repos", makeConfig(), logger);

    expect(registry.resolveForIssue()).toBe(repoA);
  });
});

describe("RepoRegistry.resolveWorkingDirectory", () => {
  const logger = makeLogger();
  const registry = new RepoRegistry("/repos-root", makeConfig(), logger);

  it("resolves an absolute directory as-is", () => {
    expect(registry.resolveWorkingDirectory(makeRepo({ directory: "/abs/path" }))).toBe(
      resolve("/abs/path"),
    );
  });

  it("joins a relative directory onto the repos root path", () => {
    expect(registry.resolveWorkingDirectory(makeRepo({ directory: "relative-repo" }))).toBe(
      resolve(join("/repos-root", "relative-repo")),
    );
  });
});

describe("RepoRegistry.validateWorkingDirectory (real filesystem)", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const logger = makeLogger();
  const registry = new RepoRegistry("/repos-root", makeConfig(), logger);

  it("throws when the working directory does not exist", () => {
    const missing = join(root, "does-not-exist");
    expect(() => registry.validateWorkingDirectory(missing)).toThrow(
      /Working directory does not exist/,
    );
  });

  it("throws when the working directory has no .git entry", () => {
    const noGit = join(root, "no-git");
    mkdirSync(noGit);
    expect(() => registry.validateWorkingDirectory(noGit)).toThrow(
      /Working directory is not a git repository/,
    );
  });

  it("accepts a directory whose .git entry is a directory (normal clone)", () => {
    const clone = join(root, "clone");
    mkdirSync(join(clone, ".git"), { recursive: true });
    expect(() => registry.validateWorkingDirectory(clone)).not.toThrow();
  });

  it("accepts a directory whose .git entry is a file (worktree)", () => {
    const worktree = join(root, "worktree");
    mkdirSync(worktree);
    writeFileSync(join(worktree, ".git"), "gitdir: /somewhere/else\n");
    expect(() => registry.validateWorkingDirectory(worktree)).not.toThrow();
  });
});

describe("RepoRegistry.validateWorkingDirectory (mocked filesystem edge cases)", () => {
  const logger = makeLogger();
  const registry = new RepoRegistry("/repos-root", makeConfig(), logger);

  afterEach(() => {
    vi.mocked(fs.existsSync).mockImplementation(actualFs.existsSync);
    vi.mocked(fs.statSync).mockImplementation(actualFs.statSync);
  });

  it("throws when the .git entry is neither a file nor a directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => false,
    } as fs.Stats);

    expect(() => registry.validateWorkingDirectory("/weird/repo")).toThrow(
      /Working directory has invalid \.git entry/,
    );
  });

  it("throws when the working directory path itself is not a directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockImplementation(
      (path: fs.PathLike) =>
        ({
          isDirectory: () => !path.toString().endsWith("not-a-dir"),
          isFile: () => false,
        }) as fs.Stats,
    );

    expect(() => registry.validateWorkingDirectory("/weird/not-a-dir")).toThrow(
      /Working directory path is not a directory/,
    );
  });
});

describe("loadRepoRegistry", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads a valid config file and logs the load", () => {
    const dir = join(root, "valid");
    mkdirSync(dir);
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getDefaultRepo()).toEqual(repoA);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "org/repoA" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the live config is missing", () => {
    const dir = join(root, "fallback");
    mkdirSync(dir);
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getDefaultRepo()).toEqual(repoA);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolve(configPath), fallback: resolve(examplePath) }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config nor the example file exists", () => {
    const dir = join(root, "missing-both");
    mkdirSync(dir);
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws a schema validation error when the config file has an invalid shape", () => {
    const dir = join(root, "invalid-schema");
    mkdirSync(dir);
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "org/repoA" }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow();
  });
});
