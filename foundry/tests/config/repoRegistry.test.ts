import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const constraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

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
        constraints,
      },
      {
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "Team B",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints,
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when defaultRepo is not present among the configured repos", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "missing-repo" }), logger as never),
    ).toThrow(/Default repo "missing-repo" not found/);
  });

  describe("lookups", () => {
    let registry: RepoRegistry;
    let logger: ReturnType<typeof makeLogger>;

    beforeEach(() => {
      logger = makeLogger();
      registry = new RepoRegistry("/root", makeConfig(), logger as never);
    });

    it("getRepoByName returns the matching entry, undefined otherwise", () => {
      expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
      expect(registry.getRepoByName("nope")).toBeUndefined();
    });

    it("getRepoByLinearProject returns the matching entry, undefined otherwise", () => {
      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("Unmapped")).toBeUndefined();
    });

    it("getDefaultRepo returns the configured default", () => {
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });

    it("listRepos returns all configured entries", () => {
      const names = registry.listRepos().map((r) => r.name);
      expect(names).toEqual(["repo-a", "repo-b"]);
    });

    describe("resolveForIssue", () => {
      it("resolves by exact Linear project match and logs debug", () => {
        const entry = registry.resolveForIssue("Project A", undefined);
        expect(entry.name).toBe("repo-a");
        expect(logger.debug).toHaveBeenCalledWith(
          { project: "Project A", repo: "repo-a" },
          "Resolved repo from Linear project",
        );
      });

      it("falls back to team-based routing when project is absent", () => {
        const entry = registry.resolveForIssue(undefined, "Team B");
        expect(entry.name).toBe("repo-b");
        expect(logger.debug).toHaveBeenCalledWith(
          { team: "Team B", repo: "repo-b" },
          "Resolved repo from Linear team",
        );
      });

      it("falls back to team routing when project is provided but unmatched", () => {
        const entry = registry.resolveForIssue("Unmapped Project", "Team B");
        expect(entry.name).toBe("repo-b");
      });

      it("throws when project is provided, unmatched, and no team is given", () => {
        expect(() => registry.resolveForIssue("Unmapped Project", undefined)).toThrow(
          /No repo mapped to Linear project "Unmapped Project"/,
        );
      });

      it("falls back to the default repo when project is unmatched and team is also unmatched", () => {
        const entry = registry.resolveForIssue("Unmapped Project", "Unmapped Team");
        expect(entry.name).toBe("repo-a");
        expect(logger.debug).toHaveBeenCalledWith(
          { fallback: "repo-a" },
          "Issue has no Linear project or team match, using default repo",
        );
      });

      it("falls back to the default repo when neither project nor team is given", () => {
        const entry = registry.resolveForIssue(undefined, undefined);
        expect(entry.name).toBe("repo-a");
      });

      it("falls back to the default repo when only an unmatched team is given", () => {
        const entry = registry.resolveForIssue(undefined, "Unmapped Team");
        expect(entry.name).toBe("repo-a");
      });
    });

    describe("resolveWorkingDirectory", () => {
      it("resolves a relative entry directory against reposRootPath", () => {
        const entry = registry.getRepoByName("repo-a")!;
        expect(registry.resolveWorkingDirectory(entry)).toBe(resolve("/root", "repo-a"));
      });

      it("uses the entry directory as-is when it is absolute", () => {
        const absoluteRegistry = new RepoRegistry(
          "/root",
          makeConfig({
            repos: [
              {
                name: "repo-a",
                directory: "/abs/path/repo-a",
                defaultBranch: "main",
                allowedPaths: [],
                protectedPaths: [],
                constraints,
              },
            ],
          }),
          logger as never,
        );
        const entry = absoluteRegistry.getRepoByName("repo-a")!;
        expect(absoluteRegistry.resolveWorkingDirectory(entry)).toBe(resolve("/abs/path/repo-a"));
      });
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string;
    let registry: RepoRegistry;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
      registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a working directory with a .git directory (normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a working directory with a .git file (worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /some/other/path\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    logger = makeLogger();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a config file that exists and logs the summary", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-b" })));

    const registry = loadRepoRegistry(configPath, "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: resolve(configPath), fallback: resolve(examplePath) }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config path nor the example fallback exists", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains JSON that fails schema validation", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    // repos must have at least one entry per ReposConfigSchema (.min(1))
    expect(() => loadRepoRegistry(configPath, "/root", logger as never)).toThrow();
  });
});
