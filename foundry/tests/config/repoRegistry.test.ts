import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

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
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 1000,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
      {
        name: "repo-b",
        directory: "repo-b",
        linearTeam: "Team B",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 1000,
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
  let reposRoot: string;
  let registry: RepoRegistry;

  beforeEach(() => {
    reposRoot = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    registry = new RepoRegistry(reposRoot, makeConfig(), noopLogger);
  });

  afterEach(() => {
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("throws when the configured defaultRepo is not present among the repos", () => {
    expect(
      () => new RepoRegistry(reposRoot, makeConfig({ defaultRepo: "does-not-exist" }), noopLogger),
    ).toThrow(/Default repo "does-not-exist" not found in registry/);
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("unknown")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("listRepos returns every configured entry", () => {
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      expect(registry.resolveForIssue("Project A", undefined).name).toBe("repo-a");
    });

    it("falls back to team-based routing when no project matches", () => {
      expect(registry.resolveForIssue(undefined, "Team B").name).toBe("repo-b");
    });

    it("prefers project match over team match when both are given and the project matches", () => {
      expect(registry.resolveForIssue("Project A", "Team B").name).toBe("repo-a");
    });

    it("throws when a project is given, does not match, and there is no team fallback", () => {
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls through to the team match when the project does not match but team does", () => {
      expect(registry.resolveForIssue("Unknown Project", "Team B").name).toBe("repo-b");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      expect(registry.resolveForIssue(undefined, undefined).name).toBe("repo-a");
    });

    it("falls back to the default repo when neither project nor team matches anything and project is absent", () => {
      expect(registry.resolveForIssue(undefined, "Unknown Team").name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root", () => {
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join(reposRoot, "repo-a"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const entry = { ...registry.getRepoByName("repo-a")!, directory: "/already/absolute" };
      expect(registry.resolveWorkingDirectory(entry)).toBe("/already/absolute");
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the directory does not exist", () => {
      expect(() => registry.validateWorkingDirectory(join(reposRoot, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const dir = join(reposRoot, "no-git");
      mkdirSync(dir);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("passes when .git is a directory (normal clone)", () => {
      const dir = join(reposRoot, "cloned-repo");
      mkdirSync(join(dir, ".git"), { recursive: true });
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      const dir = join(reposRoot, "worktree-repo");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "load-repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a registry from an existing config file", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry(configPath, dir, noopLogger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(noopLogger.info).toHaveBeenCalled();
  });

  it("falls back to the .example.json file when the configured path is missing", () => {
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry(configPath, dir, noopLogger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it("throws when neither the config file nor its example fallback exists", () => {
    const configPath = join(dir, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, dir, noopLogger)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON structure", () => {
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry(configPath, dir, noopLogger)).toThrow();
  });
});
