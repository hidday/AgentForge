import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        linearTeam: undefined,
        assigneeMe: undefined,
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
      {
        name: "repo-b",
        directory: "repo-b",
        linearProject: undefined,
        linearTeam: "Team B",
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
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when defaultRepo does not match any configured repo", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "nonexistent" }), logger as never),
    ).toThrow(/Default repo "nonexistent" not found in registry/);
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("Unknown Project")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("listRepos returns all configured entries", () => {
    const logger = makeLogger();
    const registry = new RepoRegistry("/root", makeConfig(), logger as never);
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves via exact Linear project match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Project A", undefined);
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ project: "Project A", repo: "repo-a" }),
        "Resolved repo from Linear project",
      );
    });

    it("resolves via team-based routing when project doesn't match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, "Team B");
      expect(entry.name).toBe("repo-b");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ team: "Team B", repo: "repo-b" }),
        "Resolved repo from Linear team",
      );
    });

    it("throws when project is provided but unmatched and no team fallback given", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to team routing when project is unmatched but team matches", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue("Unknown Project", "Team B");
      expect(entry.name).toBe("repo-b");
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, undefined);
      expect(entry.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: "repo-a" }),
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to default repo when team is provided but unmatched (no project)", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      const entry = registry.resolveForIssue(undefined, "Unknown Team");
      expect(entry.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root/repos", makeConfig(), logger as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/root/repos", "repo-a"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const logger = makeLogger();
      const config = makeConfig();
      config.repos[0].directory = "/abs/path/repo-a";
      const registry = new RepoRegistry("/root/repos", config, logger as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /is not a git repository/,
      );
    });

    it("passes when .git is a directory (normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("reports the working directory itself does not exist when it is a plain file with no .git child", () => {
      // A workingDirectory that is a regular file can never contain a real
      // ".git" child on the filesystem, so validateWorkingDirectory's final
      // "path is not a directory" check is unreachable in practice -- the
      // ".git" existence check above it always fails first. This asserts
      // that documented behavior instead of forcing an impossible state.
      const filePath = join(dir, "not-a-dir");
      writeFileSync(filePath, "hello");
      const logger = makeLogger();
      const registry = new RepoRegistry("/root", makeConfig(), logger as never);
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /is not a git repository/,
      );
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

  function writeConfig(path: string, config: ReposConfig): void {
    writeFileSync(path, JSON.stringify(config), "utf-8");
  }

  it("loads a valid config file from the given path", () => {
    const configPath = join(dir, "repos.config.json");
    writeConfig(configPath, makeConfig());
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the primary config is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeConfig(examplePath, makeConfig({ defaultRepo: "repo-b" }));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, dir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the config nor the example file exists", () => {
    const configPath = join(dir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON schema data", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }), "utf-8");
    const logger = makeLogger();

    // repos must have at least 1 entry (z.array(...).min(1))
    expect(() => loadRepoRegistry(configPath, dir, logger as never)).toThrow();
  });
});
