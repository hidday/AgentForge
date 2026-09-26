import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
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
      },
      {
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "Team B",
        assigneeMe: true,
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
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo isn't in the repos list", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "does-not-exist" }), logger as never),
    ).toThrow(/Default repo "does-not-exist" not found in registry/);
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("listRepos returns all configured entries", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match and logs at debug level", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Project A", undefined);
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when the project doesn't match but the team does", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, "Team B");
      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team B", repo: "repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("prefers project match over team match when both are provided and project matches", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Project A", "Team B");
      expect(entry.name).toBe("repo-a");
    });

    it("throws when a project is provided but unmatched and no team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given (no throw)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Unknown Project", "Unknown Team");
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to the default repo (with debug log) when neither project nor team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = { ...registry.getRepoByName("repo-a")!, directory: "/abs/path" };
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path");
    });

    it("joins a relative directory onto reposRootPath", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/repos-root/repo-a"));
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "reporegistry-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const missing = join(dir, "nonexistent");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (a normal clone)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      mkdirSync(join(dir, ".git"));
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (a worktree)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
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

  it("loads a valid repos.config.json and builds a working RepoRegistry", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the primary config is missing, and warns", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-b" })));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config nor the example file exists", () => {
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a Zod validation error when the config file doesn't match the schema", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "repo-a" }));
    const logger = makeLogger();

    // `repos` must have at least one entry per ReposConfigSchema.
    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });

  it("throws a JSON parse error when the config file contains invalid JSON", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, "{ this is not valid json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });
});
