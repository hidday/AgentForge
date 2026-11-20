import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function baseConstraints() {
  return {
    requiredChecks: ["lint"],
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
        constraints: baseConstraints(),
      },
      {
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "Team B",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: baseConstraints(),
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("throws when the configured defaultRepo is not present in repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry(baseDir, makeConfig({ defaultRepo: "does-not-exist" }), logger),
    ).toThrow(/Default repo "does-not-exist" not found in registry/);
  });

  describe("getRepoByName / getRepoByLinearProject / getDefaultRepo / listRepos", () => {
    it("looks up repos by name and returns undefined when missing", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
      expect(registry.getRepoByName("missing")).toBeUndefined();
    });

    it("looks up repos by linearProject and returns undefined when missing", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
    });

    it("returns the configured default repo entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });

    it("lists all configured repo entries", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      const names = registry.listRepos().map((r) => r.name);
      expect(names).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      const entry = registry.resolveForIssue("Project A", "Team B");
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is absent", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      const entry = registry.resolveForIssue(undefined, "Team B");
      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team B", repo: "repo-b" },
        "Resolved repo from Linear team",
      );
    });

    it("falls back to team-based routing when project is provided but unmatched and team matches", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      const entry = registry.resolveForIssue("Unknown Project", "Team B");
      expect(entry.name).toBe("repo-b");
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when team is given but does not match any entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);

      const entry = registry.resolveForIssue(undefined, "Unknown Team");
      expect(entry.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);
      const entry = registry.getRepoByName("repo-a")!;

      const resolved = registry.resolveWorkingDirectory(entry);
      expect(resolved).toBe(resolve(join(baseDir, "repo-a")));
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const logger = makeLogger();
      const absoluteDir = join(baseDir, "elsewhere");
      const registry = new RepoRegistry(
        baseDir,
        makeConfig({
          repos: [
            {
              name: "repo-abs",
              directory: absoluteDir,
              defaultBranch: "main",
              allowedPaths: [],
              protectedPaths: [],
              constraints: baseConstraints(),
            },
          ],
          defaultRepo: "repo-abs",
        }),
        logger,
      );
      const entry = registry.getRepoByName("repo-abs")!;

      const resolved = registry.resolveWorkingDirectory(entry);
      expect(resolved).toBe(resolve(absoluteDir));
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);
      const missing = join(baseDir, "does-not-exist");

      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory exists but has no .git entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);
      const repoDir = join(baseDir, "no-git");
      mkdirSync(repoDir);

      expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
        /is not a git repository/,
      );
    });

    it("succeeds for a normal clone where .git is a directory", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);
      const repoDir = join(baseDir, "normal-clone");
      mkdirSync(join(repoDir, ".git"), { recursive: true });

      expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
    });

    it("succeeds for a worktree where .git is a file", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);
      const repoDir = join(baseDir, "worktree-clone");
      mkdirSync(repoDir);
      writeFileSync(join(repoDir, ".git"), "gitdir: /some/other/path\n");

      expect(() => registry.validateWorkingDirectory(repoDir)).not.toThrow();
    });

    it("throws when .git exists but is neither a directory nor a regular file", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry(baseDir, makeConfig(), logger);
      const repoDir = join(baseDir, "fifo-git");
      mkdirSync(repoDir);
      const gitFifoPath = join(repoDir, ".git");
      try {
        execFileSync("mkfifo", [gitFifoPath]);
      } catch {
        // mkfifo unavailable on this platform/sandbox: skip, this branch is
        // otherwise unreachable through ordinary file operations.
        return;
      }

      expect(() => registry.validateWorkingDirectory(repoDir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });
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

  it("loads a registry from an existing config file", () => {
    const logger = makeLogger();
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry(configPath, baseDir, logger);

    expect(registry).toBeInstanceOf(RepoRegistry);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the <name>.example.json file when the main config is missing", () => {
    const logger = makeLogger();
    const configPath = join(baseDir, "repos.config.json");
    const examplePath = join(baseDir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-b" })));

    const registry = loadRepoRegistry(configPath, baseDir, logger);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolve(configPath), fallback: resolve(examplePath) }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config file nor its example fallback exist", () => {
    const logger = makeLogger();
    const configPath = join(baseDir, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, baseDir, logger)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws when the config file contains invalid JSON data (fails schema validation)", () => {
    const logger = makeLogger();
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "repo-a" }));

    expect(() => loadRepoRegistry(configPath, baseDir, logger)).toThrow();
  });

  it("throws when the config file is not valid JSON at all", () => {
    const logger = makeLogger();
    const configPath = join(baseDir, "repos.config.json");
    writeFileSync(configPath, "{ not valid json");

    expect(() => loadRepoRegistry(configPath, baseDir, logger)).toThrow();
  });
});
