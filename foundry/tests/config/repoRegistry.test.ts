import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    defaultRepo: "backend",
    repos: [
      {
        name: "backend",
        directory: "backend",
        linearProject: "Backend Platform",
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
      },
      {
        name: "team-repo",
        directory: "/abs/path/team-repo",
        linearTeam: "PRY",
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
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo does not exist among the repos", () => {
    const config = makeConfig({ defaultRepo: "missing" });
    expect(() => new RepoRegistry("/repos", config, makeLogger() as never)).toThrow(
      /Default repo "missing" not found/,
    );
  });

  it("getRepoByName and getDefaultRepo return the expected entries", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByName("backend")?.name).toBe("backend");
    expect(registry.getRepoByName("nope")).toBeUndefined();
    expect(registry.getDefaultRepo().name).toBe("backend");
  });

  it("getRepoByLinearProject finds a repo by its configured project name", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByLinearProject("Backend Platform")?.name).toBe("backend");
    expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
  });

  it("listRepos returns all configured repo entries", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.listRepos().map((r) => r.name)).toEqual(["backend", "team-repo"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact project match first", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const entry = registry.resolveForIssue("Backend Platform", undefined);
      expect(entry.name).toBe("backend");
    });

    it("falls back to team-based routing when there is no project match", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const entry = registry.resolveForIssue(undefined, "PRY");
      expect(entry.name).toBe("team-repo");
    });

    it("prefers project match over team when both are given and project matches", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const entry = registry.resolveForIssue("Backend Platform", "PRY");
      expect(entry.name).toBe("backend");
    });

    it("throws when a project is given but unmatched and no team is provided", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given and unmatched", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const entry = registry.resolveForIssue("Unknown Project", "UnknownTeam");
      expect(entry.name).toBe("backend");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const entry = registry.resolveForIssue(undefined, undefined);
      expect(entry.name).toBe("backend");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("joins a relative directory onto the repos root path", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const dir = registry.resolveWorkingDirectory(registry.getRepoByName("backend")!);
      expect(dir).toBe(join("/repos", "backend"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      const dir = registry.resolveWorkingDirectory(registry.getRepoByName("team-repo")!);
      expect(dir).toBe("/abs/path/team-repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let base: string;

    afterEach(() => {
      if (base && existsSync(base)) rmSync(base, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/no/such/dir/at/all")).toThrow(
        /does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(base)).toThrow(/not a git repository/);
    });

    it("passes when .git is a directory (normal clone)", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      mkdirSync(join(base, ".git"));
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      writeFileSync(join(base, ".git"), "gitdir: /somewhere/else\n");
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(base)).not.toThrow();
    });

    it("throws when the working directory path itself is not a directory", () => {
      base = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      const filePath = join(base, "not-a-dir");
      writeFileSync(filePath, "hello");
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      // existsSync(filePath) is true and existsSync(filePath/.git) is false,
      // so this actually exercises the "not a git repository" branch since
      // .git lookup happens before the final isDirectory() check.
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(/not a git repository/);
    });
  });
});

describe("loadRepoRegistry", () => {
  let base: string;

  afterEach(() => {
    if (base && existsSync(base)) rmSync(base, { recursive: true, force: true });
  });

  it("loads and parses a valid repos.config.json", () => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(base, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));

    const logger = makeLogger();
    const registry = loadRepoRegistry(configPath, base, logger as never);

    expect(registry.getDefaultRepo().name).toBe("backend");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "backend" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the configured path is missing", () => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(base, "repos.config.json");
    const examplePath = join(base, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig()));

    const logger = makeLogger();
    const registry = loadRepoRegistry(configPath, base, logger as never);

    expect(registry.getDefaultRepo().name).toBe("backend");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor its .example.json fallback exists", () => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(base, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, base, makeLogger() as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws a Zod validation error when the config file has an invalid shape", () => {
    base = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    const configPath = join(base, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "backend" }));

    expect(() => loadRepoRegistry(configPath, base, makeLogger() as never)).toThrow();
  });
});
