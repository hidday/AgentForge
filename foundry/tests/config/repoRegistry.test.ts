import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

// Node's ESM namespace object for built-ins is frozen, so individual exports
// (like statSync) can't be spied on directly. Route statSync through a
// hoisted, overridable mock so a single test can simulate a defensive branch
// (workingDirectory itself failing an isDirectory() check) that is otherwise
// unreachable via real filesystem operations.
const { statSyncMock } = vi.hoisted(() => ({ statSyncMock: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  statSyncMock.mockImplementation(actual.statSync);
  return { ...actual, statSync: statSyncMock };
});
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

describe("RepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds name/project/team maps and exposes lookups", () => {
    const config: ReposConfig = {
      repos: [
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", linearTeam: "Team B", assigneeMe: true }),
      ],
      defaultRepo: "repo-a",
    };
    const logger = makeLogger();
    const registry = new RepoRegistry(dir, config, logger as never);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos()).toHaveLength(2);
  });

  it("throws when defaultRepo does not match any configured repo", () => {
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "does-not-exist",
    };
    expect(() => new RepoRegistry(dir, config, makeLogger() as never)).toThrow(
      /Default repo "does-not-exist" not found/,
    );
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
          makeRepoEntry({ name: "repo-b", linearTeam: "Team B", assigneeMe: true }),
          makeRepoEntry({ name: "repo-default" }),
        ],
        defaultRepo: "repo-default",
      };
      const logger = makeLogger();
      return { registry: new RepoRegistry(dir, config, logger as never), logger };
    }

    it("resolves by exact Linear project match first", () => {
      const { registry, logger } = buildRegistry();
      const entry = registry.resolveForIssue("Project A", "Team B");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ project: "Project A", repo: "repo-a" }),
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project doesn't match", () => {
      const { registry, logger } = buildRegistry();
      const entry = registry.resolveForIssue(undefined, "Team B");
      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ team: "Team B", repo: "repo-b" }),
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is provided but unmatched and there is no team fallback", () => {
      const { registry } = buildRegistry();
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given (and team doesn't match)", () => {
      const { registry, logger } = buildRegistry();
      const entry = registry.resolveForIssue("Unknown Project", "Unknown Team");
      expect(entry.name).toBe("repo-default");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: "repo-default" }),
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const { registry } = buildRegistry();
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-default");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a", directory: "/abs/path/repo" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(dir, config, makeLogger() as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo");
    });

    it("resolves a relative directory against the repos root path", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a", directory: "nested/repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(dir, config, makeLogger() as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join(dir, "nested/repo-a"));
    });
  });

  describe("validateWorkingDirectory", () => {
    function buildRegistry() {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      return new RepoRegistry(dir, config, makeLogger() as never);
    }

    it("throws when the working directory does not exist", () => {
      const registry = buildRegistry();
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const registry = buildRegistry();
      const repoDir = join(dir, "no-git");
      mkdirSync(repoDir);
      expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a directory .git entry (normal clone)", () => {
      const registry = buildRegistry();
      const repoDir = join(dir, "clone-repo");
      mkdirSync(join(repoDir, ".git"), { recursive: true });
      expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
    });

    it("accepts a file .git entry (worktree)", () => {
      const registry = buildRegistry();
      const repoDir = join(dir, "worktree-repo");
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
      expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
    });

    it("throws when the .git entry is neither a directory nor a regular file", () => {
      const registry = buildRegistry();
      const repoDir = join(dir, "fifo-repo");
      mkdirSync(repoDir, { recursive: true });
      const gitPath = join(repoDir, ".git");
      try {
        execFileSync("mkfifo", [gitPath]);
      } catch {
        // mkfifo unavailable in this environment -- skip this edge case.
        return;
      }
      expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory itself is not a directory", () => {
      // On a real filesystem, existsSync(join(workingDirectory, ".git")) can
      // only succeed if workingDirectory is traversable as a directory, so
      // this final defensive check is otherwise unreachable through normal
      // inputs. Stub statSync for this one path to exercise it directly.
      const registry = buildRegistry();
      const repoDir = join(dir, "stat-mismatch-repo");
      mkdirSync(join(repoDir, ".git"), { recursive: true });

      const realImpl = statSyncMock.getMockImplementation();
      statSyncMock.mockImplementation((path: unknown, options?: unknown) => {
        if (path === repoDir) {
          return { isDirectory: () => false, isFile: () => false };
        }
        return realImpl?.(path as never, options as never);
      });

      try {
        expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
          /Working directory path is not a directory/,
        );
      } finally {
        statSyncMock.mockImplementation(realImpl);
      }
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(filename: string, config: unknown) {
    writeFileSync(join(dir, filename), JSON.stringify(config));
  }

  it("loads a config file that exists at the given path", () => {
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "repo-a" })],
      defaultRepo: "repo-a",
    };
    writeConfig("repos.config.json", config);
    const logger = makeLogger();

    const registry = loadRepoRegistry(join(dir, "repos.config.json"), dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json template when the primary config is missing", () => {
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "example-repo" })],
      defaultRepo: "example-repo",
    };
    writeConfig("repos.config.example.json", config);
    const logger = makeLogger();

    const registry = loadRepoRegistry(join(dir, "repos.config.json"), dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: join(dir, "repos.config.json"),
        fallback: join(dir, "repos.config.example.json"),
      }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the config nor the example fallback exists", () => {
    const logger = makeLogger();
    expect(() =>
      loadRepoRegistry(join(dir, "repos.config.json"), dir, logger as never),
    ).toThrow(/Repo config not found/);
  });

  it("throws when the config file contains invalid JSON schema", () => {
    writeConfig("repos.config.json", { repos: [], defaultRepo: "x" });
    const logger = makeLogger();
    // repos.min(1) requires at least one repo -- empty array should fail schema validation.
    expect(() =>
      loadRepoRegistry(join(dir, "repos.config.json"), dir, logger as never),
    ).toThrow();
  });
});
