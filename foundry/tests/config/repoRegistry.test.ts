import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function makeConstraints() {
  return {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
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

beforeEach(() => {
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.debug.mockClear();
  logger.error.mockClear();
});

describe("RepoRegistry constructor", () => {
  it("throws when the configured defaultRepo is not present in repos", () => {
    const config = makeConfig([makeEntry({ name: "repo-a" })], "repo-missing");
    expect(() => new RepoRegistry("/tmp", config, logger as never)).toThrow(
      /Default repo "repo-missing" not found/,
    );
  });

  it("indexes repos by linearProject and linearTeam when configured", () => {
    const config = makeConfig(
      [
        makeEntry({ name: "repo-a", linearProject: "Core" }),
        makeEntry({ name: "repo-b", linearTeam: "Infra", assigneeMe: true }),
      ],
      "repo-a",
    );
    const registry = new RepoRegistry("/tmp", config, logger as never);

    expect(registry.getRepoByLinearProject("Core")?.name).toBe("repo-a");
    expect(registry.resolveForIssue(undefined, "Infra").name).toBe("repo-b");
  });
});

describe("RepoRegistry lookups", () => {
  function buildRegistry() {
    const config = makeConfig(
      [
        makeEntry({ name: "repo-a", linearProject: "Core" }),
        makeEntry({ name: "repo-b", linearTeam: "Infra" }),
        makeEntry({ name: "repo-c" }),
      ],
      "repo-c",
    );
    return new RepoRegistry("/tmp", config, logger as never);
  }

  it("getRepoByName returns the matching entry or undefined", () => {
    const registry = buildRegistry();
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default", () => {
    const registry = buildRegistry();
    expect(registry.getDefaultRepo().name).toBe("repo-c");
  });

  it("listRepos returns all configured entries", () => {
    const registry = buildRegistry();
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b", "repo-c"]);
  });
});

describe("RepoRegistry.resolveForIssue", () => {
  function buildRegistry() {
    const config = makeConfig(
      [
        makeEntry({ name: "repo-a", linearProject: "Core" }),
        makeEntry({ name: "repo-b", linearTeam: "Infra" }),
        makeEntry({ name: "repo-default" }),
      ],
      "repo-default",
    );
    return new RepoRegistry("/tmp", config, logger as never);
  }

  it("resolves by exact linear project match", () => {
    const registry = buildRegistry();
    expect(registry.resolveForIssue("Core").name).toBe("repo-a");
    expect(logger.debug).toHaveBeenCalledWith(
      { project: "Core", repo: "repo-a" },
      "Resolved repo from Linear project",
    );
  });

  it("falls back to team match when project is absent", () => {
    const registry = buildRegistry();
    expect(registry.resolveForIssue(undefined, "Infra").name).toBe("repo-b");
  });

  it("falls back to team match when project is provided but unmatched and team matches", () => {
    const registry = buildRegistry();
    expect(registry.resolveForIssue("Unknown", "Infra").name).toBe("repo-b");
  });

  it("throws a misconfiguration error when project is given, unmatched, and no team is provided", () => {
    const registry = buildRegistry();
    expect(() => registry.resolveForIssue("Unknown")).toThrow(
      /No repo mapped to Linear project "Unknown"/,
    );
  });

  it("falls back to the default repo when project and team are both given but unmatched", () => {
    const registry = buildRegistry();
    expect(registry.resolveForIssue("Unknown", "AlsoUnknown").name).toBe("repo-default");
  });

  it("falls back to the default repo when neither project nor team is given", () => {
    const registry = buildRegistry();
    expect(registry.resolveForIssue().name).toBe("repo-default");
    expect(logger.debug).toHaveBeenCalledWith(
      { fallback: "repo-default" },
      "Issue has no Linear project or team match, using default repo",
    );
  });
});

describe("RepoRegistry.resolveWorkingDirectory", () => {
  it("resolves a relative directory against the repos root path", () => {
    const config = makeConfig([makeEntry({ name: "repo-a", directory: "repo-a" })], "repo-a");
    const registry = new RepoRegistry("/workspace/root", config, logger as never);

    const resolved = registry.resolveWorkingDirectory(registry.getRepoByName("repo-a")!);
    expect(resolved).toBe(join("/workspace/root", "repo-a"));
  });

  it("uses an absolute directory as-is", () => {
    const config = makeConfig(
      [makeEntry({ name: "repo-a", directory: "/abs/path/repo-a" })],
      "repo-a",
    );
    const registry = new RepoRegistry("/workspace/root", config, logger as never);

    const resolved = registry.resolveWorkingDirectory(registry.getRepoByName("repo-a")!);
    expect(resolved).toBe("/abs/path/repo-a");
  });
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  let baseDir: string;
  let registry: RepoRegistry;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    const config = makeConfig([makeEntry({ name: "repo-a" })], "repo-a");
    registry = new RepoRegistry(baseDir, config, logger as never);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("throws when the working directory does not exist", () => {
    const missing = join(baseDir, "does-not-exist");
    expect(() => registry.validateWorkingDirectory(missing)).toThrow(
      /Working directory does not exist/,
    );
  });

  it("throws when the directory has no .git entry", () => {
    const dir = join(baseDir, "no-git");
    mkdirSync(dir);
    expect(() => registry.validateWorkingDirectory(dir)).toThrow(
      /Working directory is not a git repository/,
    );
  });

  it("accepts a directory with a .git directory (normal clone)", () => {
    const dir = join(baseDir, "normal-clone");
    mkdirSync(dir);
    mkdirSync(join(dir, ".git"));
    expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
  });

  it("accepts a directory with a .git file (worktree)", () => {
    const dir = join(baseDir, "worktree-clone");
    mkdirSync(dir);
    writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");
    expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
  });

  it("throws when the working directory path is itself a file, not a directory", () => {
    const filePath = join(baseDir, "not-a-dir.git-parent");
    mkdirSync(filePath + "-dir");
    writeFileSync(join(filePath + "-dir", ".git"), "gitdir: x");
    // Point validateWorkingDirectory at a *file* path whose basename looks dir-like
    const fileAsWorkingDir = join(baseDir, "a-file");
    writeFileSync(fileAsWorkingDir, "not a directory");
    expect(() => registry.validateWorkingDirectory(fileAsWorkingDir)).toThrow(
      /Working directory is not a git repository/,
    );
  });

  it("throws when .git exists but is neither a file nor a directory", () => {
    const dir = join(baseDir, "weird-git");
    mkdirSync(dir);
    const gitPath = join(dir, ".git");
    try {
      execSync(`mkfifo ${JSON.stringify(gitPath)}`);
    } catch {
      // mkfifo unavailable in this environment; skip this edge case.
      return;
    }
    expect(() => registry.validateWorkingDirectory(dir)).toThrow(
      /Working directory has invalid .git entry/,
    );
  });
});

describe("loadRepoRegistry", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("loads a valid config file and logs the summary", () => {
    const configPath = join(baseDir, "repos.config.json");
    const config = makeConfig([makeEntry({ name: "repo-a" })], "repo-a");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, baseDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const configPath = join(baseDir, "repos.config.json");
    const examplePath = join(baseDir, "repos.config.example.json");
    const config = makeConfig([makeEntry({ name: "example-repo" })], "example-repo");
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, baseDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the config file nor its example fallback exist", () => {
    const configPath = join(baseDir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, baseDir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON", () => {
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(configPath, "{not valid json");
    expect(() => loadRepoRegistry(configPath, baseDir, logger as never)).toThrow();
  });

  it("throws when the config fails schema validation", () => {
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    expect(() => loadRepoRegistry(configPath, baseDir, logger as never)).toThrow();
  });
});
