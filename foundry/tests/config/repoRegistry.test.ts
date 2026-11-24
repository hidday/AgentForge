import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseConstraints() {
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
        directory: "/abs/repo-b",
        linearTeam: "Team B",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: [],
        protectedPaths: [],
        constraints: baseConstraints(),
      },
    ],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when the default repo is not present among the entries", () => {
    const config = makeConfig({ defaultRepo: "nonexistent" });
    expect(() => new RepoRegistry("/root", config, makeLogger())).toThrow(
      /Default repo "nonexistent" not found/,
    );
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getRepoByLinearProject looks up by the linearProject field", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("missing")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("listRepos returns all configured entries", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(registry.resolveForIssue("Project A", "Team B").name).toBe("repo-a");
    });

    it("falls back to team-based routing when project doesn't match", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(registry.resolveForIssue(undefined, "Team B").name).toBe("repo-b");
    });

    it("throws when a project is provided but unmatched and no team is given", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given and unmatched", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(registry.resolveForIssue("Unknown Project", "Unknown Team").name).toBe("repo-a");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(registry.resolveForIssue().name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against reposRootPath", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/root", "repo-a"));
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      const entry = registry.getRepoByName("repo-b")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/repo-b");
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
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(join(dir, "missing"))).toThrow(
        /does not exist/,
      );
    });

    it("throws when the directory has no .git entry", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(/not a git repository/);
    });

    it("passes when .git is a directory (normal clone)", () => {
      mkdirSync(join(dir, ".git"));
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/x");
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger());
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

  it("loads a registry from an existing config file", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry(configPath, "/root", makeLogger());

    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("falls back to the <name>.example.json file when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-b" })));

    const registry = loadRepoRegistry(configPath, "/root", makeLogger());

    expect(registry.getDefaultRepo().name).toBe("repo-b");
  });

  it("throws when neither the config nor an example file exists", () => {
    const configPath = join(dir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, "/root", makeLogger())).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, "{ not json");
    expect(() => loadRepoRegistry(configPath, "/root", makeLogger())).toThrow();
  });

  it("throws when the config fails schema validation", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    expect(() => loadRepoRegistry(configPath, "/root", makeLogger())).toThrow();
  });
});
