import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeConstraints() {
  return {
    requiredChecks: ["ci"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
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
        constraints: makeConstraints(),
      },
      {
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "Team B",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: makeConstraints(),
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  const logger = makeLogger();

  describe("constructor", () => {
    it("throws when defaultRepo is not present among the repos", () => {
      const config = makeConfig({ defaultRepo: "does-not-exist" });
      expect(() => new RepoRegistry("/repos", config, logger as never)).toThrow(
        /Default repo "does-not-exist" not found/,
      );
    });
  });

  describe("getRepoByName", () => {
    it("returns the matching entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(registry.getRepoByName("repo-b")?.name).toBe("repo-b");
    });

    it("returns undefined for an unknown name", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(registry.getRepoByName("nope")).toBeUndefined();
    });
  });

  describe("getRepoByLinearProject", () => {
    it("returns the matching entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    });

    it("returns undefined when no repo maps to that project", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
    });
  });

  describe("getDefaultRepo", () => {
    it("returns the configured default repo entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Project A", undefined);
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to team-based routing when project doesn't match", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, "Team B");
      expect(entry.name).toBe("repo-b");
    });

    it("throws when a project is provided but unmatched and no team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to the default repo when project is unmatched but a team is also provided and matches", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      // Project doesn't match, but team does -- team branch should win before the throw branch.
      const entry = registry.resolveForIssue("Unknown Project", "Team B");
      expect(entry.name).toBe("repo-b");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the directory unchanged (resolved) when it's absolute", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const entry = registry.getRepoByName("repo-a")!;
      const absoluteEntry = { ...entry, directory: "/abs/path/repo-a" };
      expect(registry.resolveWorkingDirectory(absoluteEntry)).toBe("/abs/path/repo-a");
    });

    it("joins relative directories against the repos root path", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos", "repo-a"));
    });
  });

  describe("listRepos", () => {
    it("returns all configured repo entries", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const names = registry.listRepos().map((r) => r.name);
      expect(names).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("validateWorkingDirectory", () => {
    let tempDirs: string[] = [];

    afterEach(() => {
      for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
      }
      tempDirs = [];
    });

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory("/does/not/exist/at/all")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      tempDirs.push(dir);

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (a normal clone)", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      tempDirs.push(dir);
      mkdirSync(join(dir, ".git"));

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (a worktree)", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      tempDirs.push(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when .git exists but is neither a directory nor a regular file (e.g. a FIFO)", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      tempDirs.push(dir);
      const gitPath = join(dir, ".git");
      execFileSync("mkfifo", [gitPath]);

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /has invalid \.git entry/,
      );
    });

    it("throws when the working directory path is a file rather than a directory", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), logger as never);
      const parent = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      tempDirs.push(parent);
      const filePath = join(parent, "not-a-dir");
      writeFileSync(filePath, "I am a file");
      // A file has no nested ".git" entry, so this is rejected at the
      // "not a git repository" check rather than reaching the final
      // isDirectory() guard -- both are valid rejections of this input.
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /is not a git repository/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    tempDirs.push(dir);
    return dir;
  }

  it("loads a valid repos.config.json and builds a registry", () => {
    const dir = tempDir();
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.listRepos()).toHaveLength(2);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const dir = tempDir();
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-b" })));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws a clear error when neither the config nor the example file exists", () => {
    const dir = tempDir();
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains malformed JSON", () => {
    const dir = tempDir();
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, "{ this is not valid json ,,, ");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });

  it("throws a schema validation error when the config violates the repos.config schema", () => {
    const dir = tempDir();
    const configPath = join(dir, "repos.config.json");
    // Missing required `directory` and `constraints` fields on the repo entry,
    // and an empty `repos` array would also violate `.min(1)`.
    writeFileSync(
      configPath,
      JSON.stringify({ repos: [{ name: "repo-a" }], defaultRepo: "repo-a" }),
    );
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });

  it("throws when repos is an empty array (violates .min(1))", () => {
    const dir = tempDir();
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "repo-a" }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });
});
