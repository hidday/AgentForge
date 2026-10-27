import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, mkfifoSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const baseConstraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [".github/"],
        constraints: baseConstraints,
      },
      {
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "TEAM-B",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [".github/"],
        constraints: baseConstraints,
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("throws when defaultRepo does not match any configured repo name", () => {
    const config = makeConfig({ defaultRepo: "nonexistent-repo" });
    expect(() => new RepoRegistry("/repos", config, logger)).toThrow(
      /Default repo "nonexistent-repo" not found in registry. Available: repo-a, repo-b/,
    );
  });

  describe("getRepoByName / getDefaultRepo", () => {
    it("returns the matching entry by name, and undefined for an unknown name", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
      expect(registry.getRepoByName("nope")).toBeUndefined();
    });

    it("returns the configured default repo entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });
  });

  describe("getRepoByLinearProject", () => {
    it("returns the repo mapped to a Linear project, and undefined otherwise", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match (highest priority)", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue("Project A", undefined);
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is unmatched but team param is provided and matches", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue(undefined, "TEAM-B");
      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "TEAM-B", repo: "repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is provided, unmatched, and no team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given and unmatched", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue("Unknown Project", "unknown-team");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-a");
    });

    it("prefers project match over team match when both are provided and both resolve", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue("Project A", "TEAM-B");
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to team match when project is provided but unmatched and team matches", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const entry = registry.resolveForIssue("Unknown Project", "TEAM-B");
      expect(entry.name).toBe("repo-b");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against reposRootPath", () => {
      const registry = new RepoRegistry("/repos-root", makeConfig(), logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "repo-a"));
    });

    it("uses an absolute directory as-is (ignoring reposRootPath)", () => {
      const config = makeConfig();
      config.repos[0]!.directory = "/absolute/path/repo-a";
      const registry = new RepoRegistry("/repos-root", config, logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/path/repo-a");
    });
  });

  describe("listRepos", () => {
    it("returns all configured repo entries", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const names = registry.listRepos().map((r) => r.name);
      expect(names).toEqual(["repo-a", "repo-b"]);
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
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      const missing = join(dir, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a directory whose .git entry is a directory (a normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a directory whose .git entry is a file (a worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /some/where\n");
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when the .git entry exists but is neither a file nor a directory", () => {
      const gitPath = join(dir, ".git");
      try {
        mkfifoSync(gitPath, 0o600);
      } catch {
        // mkfifoSync is a recent Node addition; fall back to the mkfifo(1) binary.
        execFileSync("mkfifo", [gitPath]);
      }
      const registry = new RepoRegistry("/repos", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
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

  it("loads and parses a valid config file at the given path", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos()).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("applies the defaultBranch default of 'main' when a repo entry omits it", () => {
    const config = makeConfig();
    // @ts-expect-error -- intentionally omit defaultBranch to exercise the zod default
    delete config.repos[0]!.defaultBranch;
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);
    expect(registry.getRepoByName("repo-a")!.defaultBranch).toBe("main");
  });

  it("falls back to the <name>.example.json file when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-b" })));

    const registry = loadRepoRegistry(configPath, "/repos-root", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor its example fallback exist", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow(
      /Repo config not found at/,
    );
  });

  it("propagates a zod validation error for a malformed config file", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "repo-a" }));
    // repos.min(1) rejects an empty repos array.
    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow();
  });

  it("propagates a JSON parse error for malformed JSON content", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, "{ not valid json");
    expect(() => loadRepoRegistry(configPath, "/repos-root", logger)).toThrow();
  });
});
