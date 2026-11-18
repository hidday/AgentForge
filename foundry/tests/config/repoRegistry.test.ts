import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/backend",
    directory: "backend",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo is not present among the repos", () => {
    const config: ReposConfig = {
      repos: [makeEntry({ name: "acme/backend" })],
      defaultRepo: "does-not-exist",
    };

    expect(() => new RepoRegistry("/tmp/repos", config, makeLogger() as never)).toThrow(
      /Default repo "does-not-exist" not found in registry\. Available: acme\/backend/,
    );
  });

  it("getRepoByName resolves a configured repo by name, undefined otherwise", () => {
    const config: ReposConfig = {
      repos: [makeEntry({ name: "acme/backend" })],
      defaultRepo: "acme/backend",
    };
    const registry = new RepoRegistry("/tmp/repos", config, makeLogger() as never);

    expect(registry.getRepoByName("acme/backend")?.name).toBe("acme/backend");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject resolves a configured repo by its linearProject, undefined otherwise", () => {
    const config: ReposConfig = {
      repos: [makeEntry({ name: "acme/backend", linearProject: "Backend Platform" })],
      defaultRepo: "acme/backend",
    };
    const registry = new RepoRegistry("/tmp/repos", config, makeLogger() as never);

    expect(registry.getRepoByLinearProject("Backend Platform")?.name).toBe("acme/backend");
    expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const config: ReposConfig = {
      repos: [makeEntry({ name: "acme/backend" }), makeEntry({ name: "acme/frontend" })],
      defaultRepo: "acme/frontend",
    };
    const registry = new RepoRegistry("/tmp/repos", config, makeLogger() as never);

    expect(registry.getDefaultRepo().name).toBe("acme/frontend");
  });

  it("listRepos returns every configured entry", () => {
    const config: ReposConfig = {
      repos: [makeEntry({ name: "a" }), makeEntry({ name: "b" })],
      defaultRepo: "a",
    };
    const registry = new RepoRegistry("/tmp/repos", config, makeLogger() as never);

    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["a", "b"]);
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const config: ReposConfig = {
        repos: [
          makeEntry({ name: "acme/backend", linearProject: "Backend Platform" }),
          makeEntry({
            name: "acme/infra",
            linearTeam: "INFRA",
            assigneeMe: true,
          }),
          makeEntry({ name: "acme/default" }),
        ],
        defaultRepo: "acme/default",
      };
      const logger = makeLogger();
      const registry = new RepoRegistry("/tmp/repos", config, logger as never);
      return { registry, logger };
    }

    it("resolves by exact Linear project match first", () => {
      const { registry, logger } = buildRegistry();

      const result = registry.resolveForIssue("Backend Platform", undefined);

      expect(result.name).toBe("acme/backend");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Backend Platform", repo: "acme/backend" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when no project match", () => {
      const { registry, logger } = buildRegistry();

      const result = registry.resolveForIssue(undefined, "INFRA");

      expect(result.name).toBe("acme/infra");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "INFRA", repo: "acme/infra" },
        "Resolved repo from Linear team",
      );
    });

    it("prefers project match over team match when both are provided and project matches", () => {
      const { registry } = buildRegistry();

      const result = registry.resolveForIssue("Backend Platform", "INFRA");

      expect(result.name).toBe("acme/backend");
    });

    it("falls through to team match when project is provided but unmatched, and team matches", () => {
      const { registry } = buildRegistry();

      const result = registry.resolveForIssue("Unknown Project", "INFRA");

      expect(result.name).toBe("acme/infra");
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const { registry } = buildRegistry();

      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const { registry, logger } = buildRegistry();

      const result = registry.resolveForIssue(undefined, undefined);

      expect(result.name).toBe("acme/default");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "acme/default" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when team is provided but does not match any repo", () => {
      const { registry } = buildRegistry();

      const result = registry.resolveForIssue(undefined, "UNKNOWN_TEAM");

      expect(result.name).toBe("acme/default");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const config: ReposConfig = {
        repos: [makeEntry({ name: "a", directory: "/abs/path/repo" })],
        defaultRepo: "a",
      };
      const registry = new RepoRegistry("/repos/root", config, makeLogger() as never);

      const resolved = registry.resolveWorkingDirectory(registry.getRepoByName("a")!);
      expect(resolved).toBe("/abs/path/repo");
    });

    it("joins a relative directory onto the repos root path", () => {
      const config: ReposConfig = {
        repos: [makeEntry({ name: "a", directory: "backend" })],
        defaultRepo: "a",
      };
      const registry = new RepoRegistry("/repos/root", config, makeLogger() as never);

      const resolved = registry.resolveWorkingDirectory(registry.getRepoByName("a")!);
      expect(resolved).toBe("/repos/root/backend");
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

    function makeTempDir(): string {
      const dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      tempDirs.push(dir);
      return dir;
    }

    function registry() {
      const config: ReposConfig = {
        repos: [makeEntry({ name: "a" })],
        defaultRepo: "a",
      };
      return new RepoRegistry("/repos/root", config, makeLogger() as never);
    }

    it("throws when the working directory does not exist", () => {
      const missing = join(tmpdir(), "definitely-does-not-exist-xyz");
      expect(() => registry().validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const dir = makeTempDir();
      expect(() => registry().validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a directory (a normal clone)", () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, ".git"));
      expect(() => registry().validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a regular file (a worktree)", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");
      expect(() => registry().validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when the .git entry is neither a directory nor a regular file", () => {
      const dir = makeTempDir();
      const gitPath = join(dir, ".git");
      try {
        execFileSync("mkfifo", [gitPath]);
      } catch {
        // mkfifo unavailable in this environment -- skip this edge case.
        return;
      }
      expect(existsSync(gitPath)).toBe(true);
      expect(() => registry().validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
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

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    tempDirs.push(dir);
    return dir;
  }

  function writeConfig(dir: string, filename: string, config: unknown) {
    const path = join(dir, filename);
    writeFileSync(path, JSON.stringify(config));
    return path;
  }

  it("loads the registry directly from an existing config file", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, "repos.config.json", {
      repos: [makeEntry({ name: "acme/backend" })],
      defaultRepo: "acme/backend",
    });
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("acme/backend");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "acme/backend" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the *.example.json template when the configured path is missing", () => {
    const dir = makeTempDir();
    writeConfig(dir, "repos.config.example.json", {
      repos: [makeEntry({ name: "example/repo" })],
      defaultRepo: "example/repo",
    });
    const missingPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    const registry = loadRepoRegistry(missingPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("example/repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: missingPath,
      }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor an example fallback exists", () => {
    const dir = makeTempDir();
    const missingPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(missingPath, dir, logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a zod validation error when the config file content is malformed", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir, "repos.config.json", { repos: [], defaultRepo: "x" });
    const logger = makeLogger();

    // repos.min(1) requires at least one repo entry.
    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });
});
