import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme-backend",
    directory: "acme-backend",
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

function makeConfig(repos: RepoEntry[], defaultRepo = repos[0]?.name): ReposConfig {
  return { repos, defaultRepo: defaultRepo ?? "" };
}

describe("RepoRegistry", () => {
  describe("constructor", () => {
    it("indexes repos by name, linearProject, and linearTeam", () => {
      const logger = makeLogger();
      const withProject = makeRepoEntry({ name: "repo-a", linearProject: "Platform" });
      const withTeam = makeRepoEntry({
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "ENG",
        assigneeMe: true,
      });
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([withProject, withTeam], "repo-a"),
        logger,
      );

      expect(registry.getRepoByName("repo-a")).toEqual(withProject);
      expect(registry.getRepoByName("repo-b")).toEqual(withTeam);
      expect(registry.getRepoByLinearProject("Platform")).toEqual(withProject);
      expect(registry.getRepoByName("missing")).toBeUndefined();
    });

    it("throws when defaultRepo does not match any configured repo", () => {
      const logger = makeLogger();
      const repos = [makeRepoEntry({ name: "repo-a" })];
      expect(() => new RepoRegistry("/repos", makeConfig(repos, "nonexistent"), logger)).toThrow(
        /Default repo "nonexistent" not found in registry\. Available: repo-a/,
      );
    });
  });

  describe("getDefaultRepo / listRepos", () => {
    it("returns the configured default entry and the full repo list", () => {
      const logger = makeLogger();
      const a = makeRepoEntry({ name: "repo-a" });
      const b = makeRepoEntry({ name: "repo-b", directory: "repo-b" });
      const registry = new RepoRegistry("/repos", makeConfig([a, b], "repo-b"), logger);

      expect(registry.getDefaultRepo()).toEqual(b);
      expect(registry.listRepos()).toEqual([a, b]);
    });
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const logger = makeLogger();
      const byProject = makeRepoEntry({ name: "repo-project", linearProject: "Platform" });
      const byTeam = makeRepoEntry({
        name: "repo-team",
        directory: "repo-team",
        linearTeam: "ENG",
        assigneeMe: true,
      });
      const fallback = makeRepoEntry({ name: "repo-default", directory: "repo-default" });
      const registry = new RepoRegistry(
        "/repos",
        makeConfig([byProject, byTeam, fallback], "repo-default"),
        logger,
      );
      return { registry, logger, byProject, byTeam, fallback };
    }

    it("resolves by exact Linear project match first", () => {
      const { registry, byProject } = buildRegistry();
      expect(registry.resolveForIssue("Platform", "ENG")).toEqual(byProject);
    });

    it("falls back to team-based routing when project does not match", () => {
      const { registry, byTeam } = buildRegistry();
      expect(registry.resolveForIssue(undefined, "ENG")).toEqual(byTeam);
    });

    it("falls back to team routing when project is provided but unmatched, if team matches", () => {
      const { registry, byTeam } = buildRegistry();
      expect(registry.resolveForIssue("Unmapped", "ENG")).toEqual(byTeam);
    });

    it("throws when a project is given, unmatched, and there is no team to fall back to", () => {
      const { registry } = buildRegistry();
      expect(() => registry.resolveForIssue("Unmapped", undefined)).toThrow(
        /No repo mapped to Linear project "Unmapped"/,
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const { registry, fallback, logger } = buildRegistry();
      expect(registry.resolveForIssue()).toEqual(fallback);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: "repo-default" }),
        expect.stringContaining("using default repo"),
      );
    });

    it("falls back to the default repo when team is provided but does not match", () => {
      const { registry, fallback } = buildRegistry();
      expect(registry.resolveForIssue(undefined, "UNKNOWN-TEAM")).toEqual(fallback);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the directory as-is (resolved) when it is absolute", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ directory: "/abs/path/to/repo" });
      const registry = new RepoRegistry("/repos", makeConfig([entry]), logger);
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/to/repo"));
    });

    it("joins a relative directory onto reposRootPath", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ directory: "relative-repo" });
      const registry = new RepoRegistry("/repos-root", makeConfig([entry]), logger);
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/repos-root/relative-repo"));
    });
  });

  describe("validateWorkingDirectory", () => {
    let base: string;

    afterEach(() => {
      if (base) rmSync(base, { recursive: true, force: true });
    });

    function buildRegistry() {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      return new RepoRegistry("/repos", makeConfig([entry]), logger);
    }

    it("throws when the working directory does not exist", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      const registry = buildRegistry();
      const missing = join(base, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      const registry = buildRegistry();
      expect(() => registry.validateWorkingDirectory(base)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a .git directory (normal clone)", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      mkdirSync(join(base, ".git"));
      const registry = buildRegistry();
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("accepts a .git file (worktree)", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      writeFileSync(join(base, ".git"), "gitdir: /somewhere/.git/worktrees/foo\n");
      const registry = buildRegistry();
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("throws 'not a git repository' when workingDirectory is a file rather than a directory", () => {
      // A file cannot have a ".git" child, so pointing validateWorkingDirectory
      // at a plain file always fails the .git existence check first -- this
      // exercises the same guard from a different angle to confirm files
      // (not just missing paths) are rejected before reaching statSync.
      base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      const filePath = join(base, "not-a-dir");
      writeFileSync(filePath, "hello");
      const registry = buildRegistry();
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /Working directory is not a git repository/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: unknown) {
    writeFileSync(path, JSON.stringify(config, null, 2));
  }

  it("loads a real config file and constructs a working registry", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    const configPath = join(dir, "repos.config.json");
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    writeConfig(configPath, config);
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getRepoByName("repo-a")).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("applies the defaultBranch default of 'main' when omitted", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    const configPath = join(dir, "repos.config.json");
    const entry = makeRepoEntry({ name: "repo-a" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (entry as any).defaultBranch;
    writeConfig(configPath, makeConfig([entry], "repo-a"));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getRepoByName("repo-a")?.defaultBranch).toBe("main");
  });

  it("falls back to the *.example.json file when the primary config is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo"));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getRepoByName("example-repo")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolve(configPath), fallback: resolve(examplePath) }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when both the primary config and its example fallback are missing", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow(
      /Repo config not found at/,
    );
    expect(existsSync(configPath)).toBe(false);
  });

  it("throws when the config file contains invalid JSON schema data", () => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "x" });
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow();
  });
});
