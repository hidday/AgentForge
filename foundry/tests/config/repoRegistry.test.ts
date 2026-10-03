import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";

function makeLogger() {
  const calls: { level: string; args: unknown[] }[] = [];
  return {
    logger: {
      info: (...args: unknown[]) => calls.push({ level: "info", args }),
      warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
      error: (...args: unknown[]) => calls.push({ level: "error", args }),
      debug: (...args: unknown[]) => calls.push({ level: "debug", args }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    calls,
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

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [makeRepoEntry()],
    defaultRepo: "repo-a",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws if the configured defaultRepo is not among the repos", () => {
    const { logger } = makeLogger();
    expect(
      () => new RepoRegistry("/base", makeConfig({ defaultRepo: "nope" }), logger),
    ).toThrow(/Default repo "nope" not found in registry/);
  });

  describe("getRepoByName / getDefaultRepo / listRepos", () => {
    it("looks up repos by name and returns undefined for unknown names", () => {
      const { logger } = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry("/base", makeConfig({ repos: [entry] }), logger);

      expect(registry.getRepoByName("repo-a")).toBe(entry);
      expect(registry.getRepoByName("missing")).toBeUndefined();
      expect(registry.getDefaultRepo()).toBe(entry);
      expect(registry.listRepos()).toEqual([entry]);
    });
  });

  describe("getRepoByLinearProject", () => {
    it("finds a repo mapped to a linearProject", () => {
      const { logger } = makeLogger();
      const entry = makeRepoEntry({ linearProject: "Backend" });
      const registry = new RepoRegistry(
        "/base",
        makeConfig({ repos: [entry], defaultRepo: "repo-a" }),
        logger,
      );
      expect(registry.getRepoByLinearProject("Backend")).toBe(entry);
      expect(registry.getRepoByLinearProject("Other")).toBeUndefined();
    });
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const { logger, calls } = makeLogger();
      const projectEntry = makeRepoEntry({ name: "project-repo", linearProject: "Backend" });
      const teamEntry = makeRepoEntry({
        name: "team-repo",
        directory: "team-repo",
        linearTeam: "ENG",
        assigneeMe: true,
      });
      const defaultEntry = makeRepoEntry({ name: "default-repo", directory: "default-repo" });
      const registry = new RepoRegistry(
        "/base",
        makeConfig({
          repos: [projectEntry, teamEntry, defaultEntry],
          defaultRepo: "default-repo",
        }),
        logger,
      );
      return { registry, projectEntry, teamEntry, defaultEntry, calls };
    }

    it("resolves by exact Linear project match first", () => {
      const { registry, projectEntry } = buildRegistry();
      expect(registry.resolveForIssue("Backend", "ENG")).toBe(projectEntry);
    });

    it("falls back to team-based routing when project doesn't match", () => {
      const { registry, teamEntry } = buildRegistry();
      expect(registry.resolveForIssue(undefined, "ENG")).toBe(teamEntry);
    });

    it("throws when a project is provided but unmatched and there is no team fallback", () => {
      const { registry } = buildRegistry();
      expect(() => registry.resolveForIssue("Unknown", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is provided and also unmatched", () => {
      const { registry, defaultEntry } = buildRegistry();
      expect(registry.resolveForIssue("Unknown", "UnknownTeam")).toBe(defaultEntry);
    });

    it("falls back to the default repo when neither project nor team are provided", () => {
      const { registry, defaultEntry, calls } = buildRegistry();
      expect(registry.resolveForIssue()).toBe(defaultEntry);
      expect(calls.some((c) => c.level === "debug")).toBe(true);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against reposRootPath", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base/root", makeConfig(), logger);
      const resolved = registry.resolveWorkingDirectory(makeRepoEntry({ directory: "repo-a" }));
      expect(resolved).toBe(join("/base/root", "repo-a"));
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base/root", makeConfig(), logger);
      const resolved = registry.resolveWorkingDirectory(
        makeRepoEntry({ directory: "/abs/path/repo" }),
      );
      expect(resolved).toBe("/abs/path/repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpBase: string;

    beforeEach(() => {
      tmpBase = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(tmpBase, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base", makeConfig(), logger);
      expect(() =>
        registry.validateWorkingDirectory(join(tmpBase, "missing")),
      ).toThrow(/Working directory does not exist/);
    });

    it("throws when the directory exists but has no .git entry", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory(tmpBase)).toThrow(
        /is not a git repository/,
      );
    });

    it("accepts a directory with a .git directory (normal clone)", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base", makeConfig(), logger);
      mkdirSync(join(tmpBase, ".git"));
      expect(() => registry.validateWorkingDirectory(tmpBase)).not.toThrow();
    });

    it("accepts a directory with a .git file (worktree)", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base", makeConfig(), logger);
      writeFileSync(join(tmpBase, ".git"), "gitdir: /somewhere/else\n");
      expect(() => registry.validateWorkingDirectory(tmpBase)).not.toThrow();
    });

    it("throws when the given workingDirectory path is actually a file, not a directory", () => {
      const { logger } = makeLogger();
      const registry = new RepoRegistry("/base", makeConfig(), logger);
      const filePath = join(tmpBase, "not-a-dir");
      writeFileSync(filePath, "hello");
      // A file has no .git entry inside it either, so this hits the
      // "not a git repository" branch before reaching the final isDirectory() check.
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow(
        /is not a git repository/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("loads and parses a valid repos.config.json", () => {
    const { logger, calls } = makeLogger();
    const configPath = join(tmpBase, "repos.config.json");
    const config = makeConfig();
    writeFileSync(configPath, JSON.stringify(config));

    const registry = loadRepoRegistry(configPath, tmpBase, logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(calls.some((c) => c.level === "info")).toBe(true);
  });

  it("falls back to the committed *.example.json when the configured path is missing", () => {
    const { logger, calls } = makeLogger();
    const configPath = join(tmpBase, "repos.config.json");
    const examplePath = join(tmpBase, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig({ defaultRepo: "repo-a" })));

    const registry = loadRepoRegistry(configPath, tmpBase, logger);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(calls.some((c) => c.level === "warn")).toBe(true);
  });

  it("throws when neither the configured path nor the example fallback exist", () => {
    const { logger } = makeLogger();
    const configPath = join(tmpBase, "does-not-exist.json");

    expect(() => loadRepoRegistry(configPath, tmpBase, logger)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the config file contains invalid JSON that fails schema validation", () => {
    const { logger } = makeLogger();
    const configPath = join(tmpBase, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }));

    // repos must have at least 1 entry (ReposConfigSchema: z.array(...).min(1))
    expect(() => loadRepoRegistry(configPath, tmpBase, logger)).toThrow();
  });
});
