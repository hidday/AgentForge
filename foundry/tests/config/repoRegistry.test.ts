import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    statSync: vi.fn(actual.statSync),
  };
});

import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: makeConstraints(),
    ...overrides,
  };
}

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo is not present among repos", () => {
    const logger = makeMockLogger();
    const repos = [makeRepoEntry({ name: "repo-a" })];
    expect(
      () => new RepoRegistry("/root", makeConfig(repos, "missing-repo"), logger as never),
    ).toThrow(/Default repo "missing-repo" not found in registry\. Available: repo-a/);
  });

  it("getRepoByName / getDefaultRepo / listRepos reflect the seeded repos", () => {
    const logger = makeMockLogger();
    const repoA = makeRepoEntry({ name: "repo-a" });
    const repoB = makeRepoEntry({ name: "repo-b", directory: "repo-b" });
    const registry = new RepoRegistry("/root", makeConfig([repoA, repoB], "repo-a"), logger as never);

    expect(registry.getRepoByName("repo-a")).toEqual(repoA);
    expect(registry.getRepoByName("does-not-exist")).toBeUndefined();
    expect(registry.getDefaultRepo()).toEqual(repoA);
    expect(registry.listRepos()).toHaveLength(2);
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match and logs the resolution", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);

      const resolved = registry.resolveForIssue("Project A", undefined);
      expect(resolved.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Project A", repo: "repo-a" },
        "Resolved repo from Linear project",
      );
    });

    it("getRepoByLinearProject looks up the project map directly", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
    });

    it("falls back to team-based routing when the project does not match", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearTeam: "ENG", assigneeMe: true });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);

      const resolved = registry.resolveForIssue(undefined, "ENG");
      expect(resolved.name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "ENG", repo: "repo-a" },
        "Resolved repo from Linear team",
      );
    });

    it("prefers project match over team match when both are present", () => {
      const logger = makeMockLogger();
      const repoProject = makeRepoEntry({ name: "repo-project", linearProject: "Project A" });
      const repoTeam = makeRepoEntry({ name: "repo-team", directory: "repo-team", linearTeam: "ENG" });
      const registry = new RepoRegistry(
        "/root",
        makeConfig([repoProject, repoTeam], "repo-project"),
        logger as never,
      );

      expect(registry.resolveForIssue("Project A", "ENG").name).toBe("repo-project");
    });

    it("throws when a project is given but unmatched and no team is given", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);

      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"\. Configured projects: \[Project A\]/,
      );
    });

    it("falls through to the team map when project is unmatched but a team is given", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", linearProject: "Project A" });
      const repoB = makeRepoEntry({ name: "repo-b", directory: "repo-b", linearTeam: "ENG" });
      const registry = new RepoRegistry("/root", makeConfig([repoA, repoB], "repo-a"), logger as never);

      // project given but doesn't match repoA's project, team given and matches repoB
      expect(registry.resolveForIssue("Unknown Project", "ENG").name).toBe("repo-b");
    });

    it("falls back to the default repo when neither project nor team match anything", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);

      expect(registry.resolveForIssue(undefined, undefined).name).toBe("repo-a");
      expect(registry.resolveForIssue(undefined, "unmatched-team").name).toBe("repo-a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", directory: "/abs/path/repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      expect(registry.resolveWorkingDirectory(repoA)).toBe("/abs/path/repo-a");
    });

    it("joins a relative directory under the repos root path", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a", directory: "repo-a" });
      const registry = new RepoRegistry("/root/workspace", makeConfig([repoA], "repo-a"), logger as never);
      expect(registry.resolveWorkingDirectory(repoA)).toBe(join("/root/workspace", "repo-a"));
    });
  });

  describe("validateWorkingDirectory", () => {
    let dir: string | undefined;

    afterEach(() => {
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
        dir = undefined;
      }
      vi.restoreAllMocks();
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      const missing = join(tmpdir(), "repo-registry-test-missing-dir-xyz");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      dir = mkdtempSync(join(tmpdir(), "repo-registry-no-git-"));
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a working directory whose .git entry is a directory (normal clone)", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      dir = mkdtempSync(join(tmpdir(), "repo-registry-clone-"));
      mkdirSync(join(dir, ".git"));
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a working directory whose .git entry is a file (worktree)", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      dir = mkdtempSync(join(tmpdir(), "repo-registry-worktree-"));
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/else\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when the .git entry is neither a directory nor a regular file", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      dir = mkdtempSync(join(tmpdir(), "repo-registry-weird-git-"));
      writeFileSync(join(dir, ".git"), "");

      (fs.statSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => ({ isDirectory: () => false, isFile: () => false }) as unknown as fs.Stats,
      );

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the resolved working directory path is not itself a directory", () => {
      const logger = makeMockLogger();
      const repoA = makeRepoEntry({ name: "repo-a" });
      const registry = new RepoRegistry("/root", makeConfig([repoA], "repo-a"), logger as never);
      dir = mkdtempSync(join(tmpdir(), "repo-registry-not-a-dir-"));
      mkdirSync(join(dir, ".git"));

      // First statSync call (the .git entry) returns a real directory stat;
      // the second (the working directory itself) is faked as "not a directory".
      (fs.statSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => ({ isDirectory: () => true, isFile: () => false }) as unknown as fs.Stats,
      );
      (fs.statSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => ({ isDirectory: () => false, isFile: () => false }) as unknown as fs.Stats,
      );

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory path is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("loads and parses a real repos.config.json file", () => {
    const logger = makeMockLogger();
    dir = mkdtempSync(join(tmpdir(), "repo-registry-load-"));
    const configPath = join(dir, "repos.config.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "repo-a" })], "repo-a");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, "/workspace", logger as never);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      { configPath, repoCount: 1, defaultRepo: "repo-a" },
      "Loaded repo registry",
    );
  });

  it("falls back to the committed example file when the real config is missing", () => {
    const logger = makeMockLogger();
    dir = mkdtempSync(join(tmpdir(), "repo-registry-fallback-"));
    const configPath = join(dir, "repos.config.json");
    const examplePath = join(dir, "repos.config.example.json");
    const config: ReposConfig = makeConfig([makeRepoEntry({ name: "example-repo" })], "example-repo");
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, "/workspace", logger as never);
    expect(registry.getDefaultRepo().name).toBe("example-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      { expected: configPath, fallback: examplePath },
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the real config nor the example file exist", () => {
    const logger = makeMockLogger();
    dir = mkdtempSync(join(tmpdir(), "repo-registry-missing-both-"));
    const configPath = join(dir, "repos.config.json");

    expect(() => loadRepoRegistry(configPath, "/workspace", logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws when the config file contains invalid JSON schema", () => {
    const logger = makeMockLogger();
    dir = mkdtempSync(join(tmpdir(), "repo-registry-invalid-"));
    const configPath = join(dir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry(configPath, "/workspace", logger as never)).toThrow();
  });
});
