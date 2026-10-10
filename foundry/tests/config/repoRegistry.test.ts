import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [makeRepoEntry()],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry constructor", () => {
  it("constructs fine with a valid config", () => {
    const logger = buildLogger();
    const registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("throws a clear error when defaultRepo is not found in repos list", () => {
    const logger = buildLogger();
    expect(
      () =>
        new RepoRegistry(
          "/repos-root",
          makeConfig({ defaultRepo: "missing-repo" }),
          logger as never,
        ),
    ).toThrow('Default repo "missing-repo" not found in registry. Available: repo-a');
  });
});

describe("RepoRegistry.getRepoByName / getRepoByLinearProject / getDefaultRepo", () => {
  it("finds a repo by name and returns undefined when not found", () => {
    const logger = buildLogger();
    const registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("finds a repo by linearProject and returns undefined when not found", () => {
    const logger = buildLogger();
    const config = makeConfig({
      repos: [makeRepoEntry({ name: "repo-a", linearProject: "Proj A" })],
    });
    const registry = new RepoRegistry("/repos-root", config, logger as never);

    expect(registry.getRepoByLinearProject("Proj A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("Proj Z")).toBeUndefined();
  });

  it("returns the default repo", () => {
    const logger = buildLogger();
    const registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });
});

describe("RepoRegistry.resolveForIssue", () => {
  function buildMultiRepoRegistry() {
    const logger = buildLogger();
    const config = makeConfig({
      repos: [
        makeRepoEntry({ name: "repo-project", linearProject: "Proj A" }),
        makeRepoEntry({ name: "repo-team", linearTeam: "Team X" }),
        makeRepoEntry({ name: "repo-default" }),
      ],
      defaultRepo: "repo-default",
    });
    const registry = new RepoRegistry("/repos-root", config, logger as never);
    return { registry, logger };
  }

  it("resolves by project match when found", () => {
    const { registry, logger } = buildMultiRepoRegistry();
    const result = registry.resolveForIssue("Proj A", undefined);
    expect(result.name).toBe("repo-project");
    expect(logger.debug).toHaveBeenCalledWith(
      { project: "Proj A", repo: "repo-project" },
      "Resolved repo from Linear project",
    );
  });

  it("resolves by team match when no project match (project undefined)", () => {
    const { registry, logger } = buildMultiRepoRegistry();
    const result = registry.resolveForIssue(undefined, "Team X");
    expect(result.name).toBe("repo-team");
    expect(logger.debug).toHaveBeenCalledWith(
      { team: "Team X", repo: "repo-team" },
      "Resolved repo from Linear team",
    );
  });

  it("throws with configured-projects list when project is given but unmatched and no team given", () => {
    const { registry } = buildMultiRepoRegistry();
    expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
      'No repo mapped to Linear project "Unknown Project". Configured projects: [Proj A]. ' +
        'Add a matching "linearProject" entry in repos.config.json.',
    );
  });

  it("falls through to default when team is given but unmatched", () => {
    const { registry, logger } = buildMultiRepoRegistry();
    const result = registry.resolveForIssue(undefined, "Unknown Team");
    expect(result.name).toBe("repo-default");
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "repo-default" },
      "Issue has no Linear project or team match, using default repo",
    );
  });

  it("falls through to default when project is given but unmatched and team is also given but unmatched", () => {
    const { registry } = buildMultiRepoRegistry();
    const result = registry.resolveForIssue("Unknown Project", "Unknown Team");
    expect(result.name).toBe("repo-default");
  });

  it("resolves to default with debug log when neither project nor team is given", () => {
    const { registry, logger } = buildMultiRepoRegistry();
    const result = registry.resolveForIssue();
    expect(result.name).toBe("repo-default");
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "repo-default" },
      "Issue has no Linear project or team match, using default repo",
    );
  });
});

describe("RepoRegistry.resolveWorkingDirectory", () => {
  it("resolves an absolute directory path as-is", () => {
    const logger = buildLogger();
    const config = makeConfig({
      repos: [makeRepoEntry({ name: "repo-a", directory: "/abs/path/repo-a" })],
      defaultRepo: "repo-a",
    });
    const registry = new RepoRegistry("/repos-root", config, logger as never);
    const entry = registry.getRepoByName("repo-a")!;

    expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/repo-a"));
  });

  it("resolves a relative directory joined with reposRootPath", () => {
    const logger = buildLogger();
    const config = makeConfig({
      repos: [makeRepoEntry({ name: "repo-a", directory: "relative/repo-a" })],
      defaultRepo: "repo-a",
    });
    const registry = new RepoRegistry("/repos-root", config, logger as never);
    const entry = registry.getRepoByName("repo-a")!;

    expect(registry.resolveWorkingDirectory(entry)).toBe(
      resolve(join("/repos-root", "relative/repo-a")),
    );
  });
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "rrv-test-"));
    tempDirs.push(dir);
    return dir;
  }

  function buildRegistry() {
    const logger = buildLogger();
    return new RepoRegistry("/repos-root", makeConfig(), logger as never);
  }

  it("throws when the working directory does not exist", () => {
    const registry = buildRegistry();
    const missingDir = join(makeTempDir(), "does-not-exist");

    expect(() => registry.validateWorkingDirectory(missingDir)).toThrow(
      `Working directory does not exist: ${missingDir}.`,
    );
  });

  it("throws when the directory exists but has no .git entry", () => {
    const registry = buildRegistry();
    const dir = makeTempDir();

    expect(() => registry.validateWorkingDirectory(dir)).toThrow(
      `Working directory is not a git repository: ${dir}.`,
    );
  });

  it("is valid when .git exists as a directory (normal clone)", () => {
    const registry = buildRegistry();
    const dir = makeTempDir();
    mkdirSync(join(dir, ".git"));

    expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
  });

  it("is valid when .git exists as a file (worktree)", () => {
    const registry = buildRegistry();
    const dir = makeTempDir();
    writeFileSync(join(dir, ".git"), "gitdir: /some/other/place\n");

    expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
  });

  it("throws when .git exists but is neither a directory nor a file (e.g. a FIFO)", () => {
    const registry = buildRegistry();
    const dir = makeTempDir();
    const gitDirPath = join(dir, ".git");
    execFileSync("mkfifo", [gitDirPath]);

    expect(() => registry.validateWorkingDirectory(dir)).toThrow(
      `Working directory has invalid .git entry: ${gitDirPath}. ` +
        `Expected a directory (clone) or file (worktree).`,
    );
  });

  // NOTE: the final `!stat.isDirectory()` check in validateWorkingDirectory
  // (the "Working directory path is not a directory" branch) is unreachable
  // through any real filesystem layout: it statSync()s `workingDirectory`
  // itself, but that line only runs after `existsSync(join(workingDirectory,
  // ".git"))` already returned true, and no real filesystem allows a path to
  // have a child entry (".git") unless the parent resolves as a directory.
  // `node:fs`'s named exports are non-configurable on this platform (vi.spyOn
  // throws "Cannot redefine property"), so this dead/defensive branch is left
  // uncovered rather than faked with brittle whole-module mocking.

  it("listRepos returns all configured repo entries", () => {
    const logger = buildLogger();
    const config = makeConfig({
      repos: [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
      defaultRepo: "repo-a",
    });
    const registry = new RepoRegistry("/repos-root", config, logger as never);

    const repos = registry.listRepos();
    expect(repos.map((r) => r.name)).toEqual(["repo-a", "repo-b"]);
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

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "load-registry-test-"));
    tempDirs.push(dir);
    return dir;
  }

  function writeConfig(path: string, config: unknown): void {
    writeFileSync(path, JSON.stringify(config), "utf-8");
  }

  it("loads a valid config file from disk (happy path)", () => {
    const dir = makeTempDir();
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, makeConfig());
    const logger = buildLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      { configPath: resolve(configPath), repoCount: 1, defaultRepo: "repo-a" },
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json sibling when the real config is missing", () => {
    const dir = makeTempDir();
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, makeConfig({ defaultRepo: "repo-a" }));
    const logger = buildLogger();

    expect(existsSync(configPath)).toBe(false);

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: resolve(configPath),
        fallback: resolve(examplePath),
      }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config file nor the example fallback exists", () => {
    const dir = makeTempDir();
    const configPath = join(dir, "repos.config.json");
    const logger = buildLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow(
      `Repo config not found at ${resolve(configPath)} and no example fallback at ${resolve(
        join(dir, "repos.config.example.json"),
      )}.`,
    );
  });

  it("throws when the config file contains malformed JSON", () => {
    const dir = makeTempDir();
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, "{ not valid json", "utf-8");
    const logger = buildLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });

  it("throws when the config file is schema-invalid (Zod parse failure)", () => {
    const dir = makeTempDir();
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "repo-a" });
    const logger = buildLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });
});
