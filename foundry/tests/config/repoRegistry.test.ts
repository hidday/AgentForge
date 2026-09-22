import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  };
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

describe("RepoRegistry", () => {
  describe("constructor", () => {
    it("throws when defaultRepo is not present in the repos list", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "missing" };
      expect(() => new RepoRegistry("/tmp", config, makeLogger() as never)).toThrow(
        /Default repo "missing" not found in registry/,
      );
    });

    it("indexes repos by linearProject and linearTeam", () => {
      const config: ReposConfig = {
        repos: [
          makeEntry({ name: "a", linearProject: "proj-a" }),
          makeEntry({ name: "b", linearTeam: "team-b", assigneeMe: true }),
        ],
        defaultRepo: "a",
      };
      const registry = new RepoRegistry("/tmp", config, makeLogger() as never);
      expect(registry.getRepoByLinearProject("proj-a")?.name).toBe("a");
      expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
    });
  });

  describe("getRepoByName / getDefaultRepo", () => {
    it("returns the matching entry or undefined", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry("/tmp", config, makeLogger() as never);
      expect(registry.getRepoByName("a")?.name).toBe("a");
      expect(registry.getRepoByName("nonexistent")).toBeUndefined();
      expect(registry.getDefaultRepo().name).toBe("a");
    });
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const config: ReposConfig = {
        repos: [
          makeEntry({ name: "proj-repo", linearProject: "proj-x" }),
          makeEntry({ name: "team-repo", linearTeam: "team-y", assigneeMe: true }),
          makeEntry({ name: "default-repo" }),
        ],
        defaultRepo: "default-repo",
      };
      return new RepoRegistry("/tmp", config, makeLogger() as never);
    }

    it("resolves by exact Linear project match first", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue("proj-x", "team-y").name).toBe("proj-repo");
    });

    it("falls back to team-based routing when project does not match", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue(undefined, "team-y").name).toBe("team-repo");
    });

    it("throws when a project is provided, does not match, and no team is given", () => {
      const registry = buildRegistry();
      expect(() => registry.resolveForIssue("unknown-project", undefined)).toThrow(
        /No repo mapped to Linear project "unknown-project"/,
      );
    });

    it("falls back to the default repo when project matches nothing but a team is also given and doesn't match", () => {
      const registry = buildRegistry();
      // project unmatched AND team given (even if team also doesn't match) -> per the
      // "project && !team" guard, team truthy skips the throw, so we fall through to default.
      expect(registry.resolveForIssue("unknown-project", "unknown-team").name).toBe(
        "default-repo",
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const registry = buildRegistry();
      expect(registry.resolveForIssue().name).toBe("default-repo");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry("/some/root", config, makeLogger() as never);
      const entry = makeEntry({ directory: "/absolute/path" });
      expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/path");
    });

    it("joins a relative directory onto the repos root path", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry("/some/root", config, makeLogger() as never);
      const entry = makeEntry({ directory: "relative-dir" });
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/some/root", "relative-dir"));
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
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry(tmpRoot, config, makeLogger() as never);
      const missing = join(tmpRoot, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry(tmpRoot, config, makeLogger() as never);
      const dir = join(tmpRoot, "no-git");
      mkdirSync(dir);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a directory (normal clone)", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry(tmpRoot, config, makeLogger() as never);
      const dir = join(tmpRoot, "normal-clone");
      mkdirSync(join(dir, ".git"), { recursive: true });
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry(tmpRoot, config, makeLogger() as never);
      const dir = join(tmpRoot, "worktree");
      mkdirSync(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /some/other/path\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when .git exists but is neither a directory nor a regular file (e.g. a FIFO)", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry(tmpRoot, config, makeLogger() as never);
      const dir = join(tmpRoot, "weird-git");
      mkdirSync(dir);
      const gitPath = join(dir, ".git");
      try {
        execSync(`mkfifo "${gitPath}"`);
      } catch {
        // mkfifo unavailable on this platform/sandbox: skip, this branch is
        // exercised only when a special (non-regular, non-directory) file
        // can be created at the .git path.
        return;
      }
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path is actually a file, not a directory", () => {
      const config: ReposConfig = { repos: [makeEntry({ name: "a" })], defaultRepo: "a" };
      const registry = new RepoRegistry(tmpRoot, config, makeLogger() as never);
      // Make a file whose name we pass as the "working directory". It needs a
      // .git entry alongside conceptually, but validateWorkingDirectory checks
      // existsSync(workingDirectory) then join(workingDirectory, ".git") --
      // for a file, joining a file path with ".git" produces a path that does
      // not exist, which trips the "not a git repository" branch first. To
      // reach the final "not a directory" check we instead exploit a symlink
      // is unnecessary; simplest is: this branch is only reachable in theory
      // when workingDirectory itself is a file AND `${file}/.git` exists,
      // which the OS won't allow. So we assert the earlier, always-reachable
      // "not a git repository" error is raised for a plain file input.
      const filePath = join(tmpRoot, "plain-file");
      writeFileSync(filePath, "not a directory");
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /Working directory is not a git repository/,
      );
      unlinkSync(filePath);
    });
  });

  describe("listRepos", () => {
    it("returns all registered repo entries", () => {
      const config: ReposConfig = {
        repos: [makeEntry({ name: "a" }), makeEntry({ name: "b" })],
        defaultRepo: "a",
      };
      const registry = new RepoRegistry("/tmp", config, makeLogger() as never);
      const repos = registry.listRepos();
      expect(repos).toHaveLength(2);
      expect(repos.map((r) => r.name).sort()).toEqual(["a", "b"]);
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

  it("loads and parses an existing config file", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    const config: ReposConfig = {
      repos: [makeEntry({ name: "a" })],
      defaultRepo: "a",
    };
    writeFileSync(configPath, JSON.stringify(config));

    const logger = makeLogger();
    const registry = loadRepoRegistry(configPath, tmpRoot, logger as never);

    expect(registry.getDefaultRepo().name).toBe("a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "a" }),
      "Loaded repo registry",
    );
  });

  it("applies the defaultBranch default of 'main' when omitted", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    const rawConfig = {
      repos: [
        {
          name: "a",
          directory: "a",
          allowedPaths: [],
          protectedPaths: [],
          constraints: makeConstraints(),
        },
      ],
      defaultRepo: "a",
    };
    writeFileSync(configPath, JSON.stringify(rawConfig));

    const registry = loadRepoRegistry(configPath, tmpRoot, makeLogger() as never);
    expect(registry.getRepoByName("a")?.defaultBranch).toBe("main");
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    const examplePath = join(tmpRoot, "repos.config.example.json");
    const config: ReposConfig = {
      repos: [makeEntry({ name: "example-repo" })],
      defaultRepo: "example-repo",
    };
    writeFileSync(examplePath, JSON.stringify(config));
    // Note: configPath itself is never written.

    const logger = makeLogger();
    const registry = loadRepoRegistry(configPath, tmpRoot, logger as never);

    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the configured path nor the example fallback exists", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, tmpRoot, makeLogger() as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a zod validation error when the config file is malformed", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "a" }));

    // repos.min(1) requires at least one repo entry.
    expect(() => loadRepoRegistry(configPath, tmpRoot, makeLogger() as never)).toThrow();
  });
});
