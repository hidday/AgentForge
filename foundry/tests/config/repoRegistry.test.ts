import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
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

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "acme/widgets",
        directory: "widgets",
        linearProject: "Widgets",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: makeConstraints(),
      },
      {
        name: "acme/gadgets",
        directory: "/abs/path/gadgets",
        linearTeam: "GAD",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: makeConstraints(),
      },
    ],
    defaultRepo: "acme/widgets",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  describe("constructor", () => {
    it("throws when defaultRepo does not match any entry", () => {
      const logger = makeLogger();
      expect(() => new RepoRegistry("/repos", makeConfig({ defaultRepo: "nope" }), logger)).toThrow(
        /Default repo "nope" not found in registry/,
      );
    });
  });

  describe("getRepoByName / getDefaultRepo / listRepos", () => {
    it("looks up entries by name and returns undefined for unknown names", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(registry.getRepoByName("acme/widgets")?.name).toBe("acme/widgets");
      expect(registry.getRepoByName("missing")).toBeUndefined();
    });

    it("returns the configured default repo", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(registry.getDefaultRepo().name).toBe("acme/widgets");
    });

    it("lists every configured repo", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(registry.listRepos().map((r) => r.name)).toEqual(["acme/widgets", "acme/gadgets"]);
    });
  });

  describe("getRepoByLinearProject", () => {
    it("finds the repo mapped to a Linear project", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(registry.getRepoByLinearProject("Widgets")?.name).toBe("acme/widgets");
    });

    it("returns undefined for an unmapped project", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
    });
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);

      const result = registry.resolveForIssue("Widgets", "GAD");

      expect(result.name).toBe("acme/widgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Widgets", repo: "acme/widgets" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when the project doesn't match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);

      const result = registry.resolveForIssue(undefined, "GAD");

      expect(result.name).toBe("acme/gadgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "GAD", repo: "acme/gadgets" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given, doesn't match, and no team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());

      expect(() => registry.resolveForIssue("Unmapped")).toThrow(
        /No repo mapped to Linear project "Unmapped"/,
      );
    });

    it("falls back to the default repo when project matches nothing but a team is also given and doesn't match", () => {
      const logger = makeLogger();
      const registry = new RepoRegistry("/repos", makeConfig(), logger);

      const result = registry.resolveForIssue("Unmapped", "AlsoUnmapped");

      expect(result.name).toBe("acme/widgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "acme/widgets" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());

      expect(registry.resolveForIssue().name).toBe("acme/widgets");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the directory as-is (resolved) when it is already absolute", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      const entry = registry.getRepoByName("acme/gadgets");
      expect(registry.resolveWorkingDirectory(entry!)).toBe("/abs/path/gadgets");
    });

    it("joins a relative directory onto the repos root path", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      const entry = registry.getRepoByName("acme/widgets");
      expect(registry.resolveWorkingDirectory(entry!)).toBe("/repos/widgets");
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

    it("throws when the directory does not exist", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory has no .git entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (a normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (a worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
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

  it("loads the config from the given path when it exists", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos", logger);

    expect(registry.getDefaultRepo().name).toBe("acme/widgets");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 2, defaultRepo: "acme/widgets" }),
      "Loaded repo registry",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the *.example.json template and warns when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, "/repos", logger);

    expect(registry.getDefaultRepo().name).toBe("acme/widgets");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor an example template exists", () => {
    const configPath = join(dir, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, "/repos", makeLogger())).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws (via zod) when the config file is present but invalid", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry(configPath, "/repos", makeLogger())).toThrow();
  });
});
