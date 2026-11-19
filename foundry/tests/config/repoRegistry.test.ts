import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
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
        name: "main-repo",
        directory: "main",
        linearProject: "Backend",
        linearTeam: "ENG",
        allowedPaths: ["src/"],
        protectedPaths: [".github/"],
        defaultBranch: "main",
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
    defaultRepo: "main-repo",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws if the configured defaultRepo is not present among repos", () => {
    const config = makeConfig({ defaultRepo: "missing-repo" });
    expect(() => new RepoRegistry("/root", config, makeLogger() as never)).toThrow(
      /Default repo "missing-repo" not found/,
    );
  });

  it("looks up a repo by name", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByName("main-repo")?.directory).toBe("main");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("resolveForIssue matches by Linear project first", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    const entry = registry.resolveForIssue("Backend", "OTHER");
    expect(entry.name).toBe("main-repo");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ project: "Backend" }),
      "Resolved repo from Linear project",
    );
  });

  it("resolveForIssue falls back to team match when project doesn't match", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    const entry = registry.resolveForIssue(undefined, "ENG");
    expect(entry.name).toBe("main-repo");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ team: "ENG" }),
      "Resolved repo from Linear team",
    );
  });

  it("resolveForIssue throws when a project is given but unmatched and no team is given", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(() => registry.resolveForIssue("Unknown-Project", undefined)).toThrow(
      /No repo mapped to Linear project "Unknown-Project"/,
    );
  });

  it("resolveForIssue falls back to the default repo when project is unmatched but a team is present and also unmatched", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    const entry = registry.resolveForIssue("Unknown-Project", "unknown-team");
    expect(entry.name).toBe("main-repo");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: "main-repo" }),
      expect.any(String),
    );
  });

  it("resolveForIssue falls back to the default repo when neither project nor team are given", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.resolveForIssue().name).toBe("main-repo");
  });

  it("resolveWorkingDirectory resolves a relative directory against reposRootPath", () => {
    const registry = new RepoRegistry("/root/path", makeConfig(), makeLogger() as never);
    const entry = registry.getRepoByName("main-repo")!;
    expect(registry.resolveWorkingDirectory(entry)).toBe(join("/root/path", "main"));
  });

  it("resolveWorkingDirectory returns an absolute directory unchanged (resolved)", () => {
    const registry = new RepoRegistry("/root/path", makeConfig(), makeLogger() as never);
    const entry = {
      ...registry.getRepoByName("main-repo")!,
      directory: "/abs/repo",
    };
    expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/repo");
  });

  it("listRepos returns all configured entries", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.listRepos()).toHaveLength(1);
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("throws when the directory does not exist", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(/not a git repository/);
    });

    it("accepts a directory with a .git subdirectory (normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a directory with a .git file (worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x");
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads config from the given path when it exists", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("main-repo");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "main-repo" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json template when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "main-repo" })));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("main-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor an example fallback exist", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, dir, makeLogger() as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid schema data", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    expect(() => loadRepoRegistry(configPath, dir, makeLogger() as never)).toThrow();
  });
});
