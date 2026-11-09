import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConstraints() {
  return {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
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

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo is not among the repos", () => {
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-missing");
    expect(() => new RepoRegistry("/root", config, makeLogger())).toThrow(
      /Default repo "repo-missing" not found/,
    );
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    const registry = new RepoRegistry("/root", config, makeLogger());
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const config = makeConfig(
      [makeRepoEntry({ name: "repo-a", linearProject: "Project A" }), makeRepoEntry({ name: "repo-b" })],
      "repo-a",
    );
    const registry = new RepoRegistry("/root", config, makeLogger());
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const config = makeConfig(
      [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
      "repo-b",
    );
    const registry = new RepoRegistry("/root", config, makeLogger());
    expect(registry.getDefaultRepo().name).toBe("repo-b");
  });

  it("listRepos returns all configured entries", () => {
    const config = makeConfig(
      [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
      "repo-a",
    );
    const registry = new RepoRegistry("/root", config, makeLogger());
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const logger = makeLogger();
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", linearProject: "Project A" }), makeRepoEntry({ name: "repo-b" })],
        "repo-b",
      );
      const registry = new RepoRegistry("/root", config, logger);
      const resolved = registry.resolveForIssue("Project A");
      expect(resolved.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("resolves by Linear team when no project match", () => {
      const logger = makeLogger();
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", linearTeam: "Team A", assigneeMe: true }), makeRepoEntry({ name: "repo-b" })],
        "repo-b",
      );
      const registry = new RepoRegistry("/root", config, logger);
      const resolved = registry.resolveForIssue(undefined, "Team A");
      expect(resolved.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team A", repo: "repo-a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given, is unmatched, and no team is given", () => {
      const config = makeConfig(
        [makeRepoEntry({ name: "repo-a", linearProject: "Project A" })],
        "repo-a",
      );
      const registry = new RepoRegistry("/root", config, makeLogger());
      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to default when a project is unmatched but a team is also given (no team match)", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry("/root", config, makeLogger());
      const resolved = registry.resolveForIssue("Unknown Project", "Unknown Team");
      expect(resolved.name).toBe("repo-a");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const config = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
      const registry = new RepoRegistry("/root", config, logger);
      const resolved = registry.resolveForIssue();
      expect(resolved.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a", directory: "/abs/path" })], "repo-a");
      const registry = new RepoRegistry("/root", config, makeLogger());
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path");
    });

    it("joins a relative directory under the repos root path", () => {
      const config = makeConfig([makeRepoEntry({ name: "repo-a", directory: "relative/dir" })], "repo-a");
      const registry = new RepoRegistry("/root/base", config, makeLogger());
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/root/base/relative/dir");
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry(
        "/root",
        makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a"),
        makeLogger(),
      );
      const missing = join(tmpRoot, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const registry = new RepoRegistry(
        "/root",
        makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a"),
        makeLogger(),
      );
      mkdirSync(join(tmpRoot, "not-a-repo"));
      expect(() => registry.validateWorkingDirectory(join(tmpRoot, "not-a-repo"))).toThrow(
        /is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (normal clone)", () => {
      const registry = new RepoRegistry(
        "/root",
        makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a"),
        makeLogger(),
      );
      const repoDir = join(tmpRoot, "normal-clone");
      mkdirSync(join(repoDir, ".git"), { recursive: true });
      expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
    });

    it("succeeds when .git is a file (worktree)", () => {
      const registry = new RepoRegistry(
        "/root",
        makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a"),
        makeLogger(),
      );
      const repoDir = join(tmpRoot, "worktree-clone");
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, ".git"), "gitdir: /somewhere/.git/worktrees/x");
      expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
    });

    it("throws when .git exists but is neither a directory nor a regular file", () => {
      const registry = new RepoRegistry(
        "/root",
        makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a"),
        makeLogger(),
      );
      const repoDir = join(tmpRoot, "fifo-git-entry");
      mkdirSync(repoDir, { recursive: true });
      const gitDir = join(repoDir, ".git");
      // A FIFO (named pipe) is neither a directory nor a regular file, exercising
      // the defensive "invalid .git entry" branch.
      execFileSync("mkfifo", [gitDir]);
      expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads and parses a valid config file at the given path", () => {
    const logger = makeLogger();
    const configPath = join(tmpRoot, "repos.config.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpRoot, logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json file when the configured path is missing but an example exists", () => {
    const logger = makeLogger();
    const configPath = join(tmpRoot, "repos.config.json");
    const examplePath = join(tmpRoot, "repos.config.example.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo");
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpRoot, logger);

    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when the configured path and its example fallback are both missing", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, tmpRoot, makeLogger())).toThrow(
      /Repo config not found/,
    );
  });

  it("throws a zod validation error when the config file content is invalid", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    // repos: z.array(RepoEntrySchema).min(1) requires at least one repo.
    expect(() => loadRepoRegistry(configPath, tmpRoot, makeLogger())).toThrow();
  });
});
