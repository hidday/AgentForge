import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        linearTeam: "Team A",
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
  it("throws when the configured defaultRepo is not among the repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "missing" }), logger as never),
    ).toThrow(/Default repo "missing" not found in registry/);
  });

  it("getRepoByName() returns the matching entry or undefined", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject() returns the entry mapped to that project", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
  });

  it("getDefaultRepo() returns the configured default entry", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("listRepos() returns all configured entries", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.listRepos()).toHaveLength(1);
  });

  describe("resolveForIssue()", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Project A", "Other Team");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when the project does not match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, "Team A");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team A", repo: "repo-a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given but unmatched and there is no team fallback", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given and unmatched", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Unknown Project", "Unknown Team");
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
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

  describe("resolveWorkingDirectory()", () => {
    it("resolves a relative directory against the repos root path", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/root", "repo-a"));
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const config = makeConfig({
        repos: [
          {
            ...makeConfig().repos[0],
            directory: "/abs/path/repo-a",
          },
        ],
      });
      const registry = new RepoRegistry("/root", config, makeLogger() as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo-a");
    });
  });

  describe("validateWorkingDirectory()", () => {
    const dirsToClean: string[] = [];

    afterEach(() => {
      while (dirsToClean.length) {
        const dir = dirsToClean.pop();
        if (dir) rmSync(dir, { recursive: true, force: true });
      }
    });

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/definitely/not/here")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      dirsToClean.push(base);
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(base)).toThrow(
        /is not a git repository/,
      );
    });

    it("passes when .git is a directory (a normal clone)", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      dirsToClean.push(base);
      mkdirSync(join(base, ".git"));
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("passes when .git is a file (a worktree)", () => {
      const base = mkdtempSync(join(tmpdir(), "repo-registry-"));
      dirsToClean.push(base);
      writeFileSync(join(base, ".git"), "gitdir: /somewhere/else\n");
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry()", () => {
  const dirsToClean: string[] = [];

  afterEach(() => {
    while (dirsToClean.length) {
      const dir = dirsToClean.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads and parses a repos.config.json at the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-config-"));
    dirsToClean.push(dir);
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-config-"));
    dirsToClean.push(dir);
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-a" })));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the configured path nor the example fallback exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-config-"));
    dirsToClean.push(dir);
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the file contents fail schema validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-config-"));
    dirsToClean.push(dir);
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow();
  });
});
