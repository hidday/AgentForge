import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
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

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry", () => {
  it("throws when defaultRepo does not match any entry", () => {
    const logger = makeLogger();
    const config = makeConfig([makeRepoEntry({ name: "a" })], "does-not-exist");
    expect(() => new RepoRegistry("/root", config, logger as never)).toThrow(
      /Default repo "does-not-exist" not found/,
    );
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ name: "a" });
    const registry = new RepoRegistry("/root", makeConfig([entry], "a"), logger as never);
    expect(registry.getRepoByName("a")).toEqual(entry);
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ name: "a" });
    const registry = new RepoRegistry("/root", makeConfig([entry], "a"), logger as never);
    expect(registry.getDefaultRepo()).toEqual(entry);
  });

  it("listRepos returns all configured entries", () => {
    const logger = makeLogger();
    const entries = [makeRepoEntry({ name: "a" }), makeRepoEntry({ name: "b" })];
    const registry = new RepoRegistry("/root", makeConfig(entries, "a"), logger as never);
    expect(registry.listRepos()).toHaveLength(2);
  });

  it("getRepoByLinearProject indexes only entries with linearProject set", () => {
    const logger = makeLogger();
    const withProject = makeRepoEntry({ name: "a", linearProject: "Proj A" });
    const withoutProject = makeRepoEntry({ name: "b" });
    const registry = new RepoRegistry(
      "/root",
      makeConfig([withProject, withoutProject], "a"),
      logger as never,
    );
    expect(registry.getRepoByLinearProject("Proj A")).toEqual(withProject);
    expect(registry.getRepoByLinearProject("Nonexistent")).toBeUndefined();
  });

  describe("resolveForIssue", () => {
    it("resolves via exact Linear project match first", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "a", linearProject: "Proj A" });
      const fallback = makeRepoEntry({ name: "default" });
      const registry = new RepoRegistry("/root", makeConfig([entry, fallback], "default"), logger as never);

      const result = registry.resolveForIssue("Proj A", undefined);
      expect(result).toEqual(entry);
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Proj A", repo: "a" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is unset but team matches", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "a", linearTeam: "Team A", assigneeMe: true });
      const fallback = makeRepoEntry({ name: "default" });
      const registry = new RepoRegistry("/root", makeConfig([entry, fallback], "default"), logger as never);

      const result = registry.resolveForIssue(undefined, "Team A");
      expect(result).toEqual(entry);
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team A", repo: "a" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when project is provided but unmatched and no team is given", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "a", linearProject: "Proj A" });
      const registry = new RepoRegistry("/root", makeConfig([entry], "a"), logger as never);

      expect(() => registry.resolveForIssue("Proj B", undefined)).toThrow(
        /No repo mapped to Linear project "Proj B"/,
      );
    });

    it("falls back to team routing when project is provided but unmatched, if a team is also given and matches", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "a", linearProject: "Proj A" });
      const teamEntry = makeRepoEntry({ name: "b", linearTeam: "Team B" });
      const registry = new RepoRegistry("/root", makeConfig([entry, teamEntry], "a"), logger as never);

      const result = registry.resolveForIssue("Proj Unmatched", "Team B");
      expect(result).toEqual(teamEntry);
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const logger = makeLogger();
      const fallback = makeRepoEntry({ name: "default" });
      const registry = new RepoRegistry("/root", makeConfig([fallback], "default"), logger as never);

      const result = registry.resolveForIssue(undefined, undefined);
      expect(result).toEqual(fallback);
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "default" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when project and team are both given but neither matches", () => {
      const logger = makeLogger();
      const fallback = makeRepoEntry({ name: "default" });
      const registry = new RepoRegistry("/root", makeConfig([fallback], "default"), logger as never);

      const result = registry.resolveForIssue("Unmatched Project", "Unmatched Team");
      expect(result).toEqual(fallback);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "a", directory: "backend" });
      const registry = new RepoRegistry("/workspace/root", makeConfig([entry], "a"), logger as never);
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/workspace/root", "backend"));
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "a", directory: "/abs/path/backend" });
      const registry = new RepoRegistry("/workspace/root", makeConfig([entry], "a"), logger as never);
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/backend");
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry("/root", makeConfig([entry], "acme/backend"), logger as never);
      expect(() => registry.validateWorkingDirectory(join(tmpDir, "does-not-exist"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry("/root", makeConfig([entry], "acme/backend"), logger as never);
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /is not a git repository/,
      );
    });

    it("accepts a .git directory (a normal clone)", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry("/root", makeConfig([entry], "acme/backend"), logger as never);
      mkdirSync(join(tmpDir, ".git"));
      expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
    });

    it("accepts a .git file (a worktree)", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry("/root", makeConfig([entry], "acme/backend"), logger as never);
      writeFileSync(join(tmpDir, ".git"), "gitdir: /somewhere/else");
      expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
    });

    it("throws when .git exists but is neither a file nor a directory", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry("/root", makeConfig([entry], "acme/backend"), logger as never);
      const gitPath = join(tmpDir, ".git");
      try {
        execSync(`mkfifo "${gitPath}"`);
      } catch {
        // mkfifo unavailable in this environment; skip this assertion path.
        return;
      }
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /invalid \.git entry/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses a valid repos.config.json, returning a working RepoRegistry", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    const config = makeConfig([makeRepoEntry({ name: "acme/backend" })], "acme/backend");
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);
    expect(registry.getDefaultRepo().name).toBe("acme/backend");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 1, defaultRepo: "acme/backend" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json template when the configured path is missing", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    const config = makeConfig([makeRepoEntry({ name: "example/repo" })], "example/repo");
    writeFileSync(examplePath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);
    expect(registry.getDefaultRepo().name).toBe("example/repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("falling back to the committed example"),
    );
  });

  it("throws when neither the configured path nor the example fallback exists", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, tmpDir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws (via ReposConfigSchema.parse) when the config file contains invalid JSON shape", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));
    // repos.min(1) requires at least one repo entry
    expect(() => loadRepoRegistry(configPath, tmpDir, logger as never)).toThrow();
  });

  it("applies the defaultBranch default of 'main' when omitted from a repo entry", () => {
    const logger = makeLogger();
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: [
          {
            name: "acme/backend",
            directory: "backend",
            allowedPaths: [],
            protectedPaths: [],
            constraints: makeConstraints(),
          },
        ],
        defaultRepo: "acme/backend",
      }),
    );
    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);
    expect(registry.getDefaultRepo().defaultBranch).toBe("main");
  });
});
