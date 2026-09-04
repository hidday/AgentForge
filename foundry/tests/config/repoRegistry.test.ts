import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    name: "acme/widgets",
    directory: "widgets",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("throws when defaultRepo does not match any configured repo", () => {
    const logger = makeLogger();
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "acme/widgets" })],
      defaultRepo: "acme/does-not-exist",
    };

    expect(() => new RepoRegistry(root, config, logger as never)).toThrow(
      /Default repo "acme\/does-not-exist" not found in registry\. Available: acme\/widgets/,
    );
  });

  it("getRepoByName returns the entry by name and undefined for unknown names", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ name: "acme/widgets" });
    const registry = new RepoRegistry(
      root,
      { repos: [entry], defaultRepo: "acme/widgets" },
      logger as never,
    );

    expect(registry.getRepoByName("acme/widgets")).toEqual(entry);
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ name: "acme/widgets" });
    const registry = new RepoRegistry(
      root,
      { repos: [entry], defaultRepo: "acme/widgets" },
      logger as never,
    );

    expect(registry.getDefaultRepo()).toEqual(entry);
  });

  it("listRepos returns all configured repos", () => {
    const logger = makeLogger();
    const a = makeRepoEntry({ name: "acme/a" });
    const b = makeRepoEntry({ name: "acme/b" });
    const registry = new RepoRegistry(
      root,
      { repos: [a, b], defaultRepo: "acme/a" },
      logger as never,
    );

    expect(registry.listRepos()).toEqual([a, b]);
  });

  it("getRepoByLinearProject resolves entries indexed by linearProject", () => {
    const logger = makeLogger();
    const entry = makeRepoEntry({ name: "acme/widgets", linearProject: "Widgets" });
    const registry = new RepoRegistry(
      root,
      { repos: [entry], defaultRepo: "acme/widgets" },
      logger as never,
    );

    expect(registry.getRepoByLinearProject("Widgets")).toEqual(entry);
    expect(registry.getRepoByLinearProject("Other")).toBeUndefined();
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const logger = makeLogger();
      const projectEntry = makeRepoEntry({ name: "acme/proj", linearProject: "Proj" });
      const defaultEntry = makeRepoEntry({ name: "acme/default" });
      const registry = new RepoRegistry(
        root,
        { repos: [projectEntry, defaultEntry], defaultRepo: "acme/default" },
        logger as never,
      );

      const result = registry.resolveForIssue("Proj", undefined);
      expect(result).toEqual(projectEntry);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ project: "Proj", repo: "acme/proj" }),
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project is unset", () => {
      const logger = makeLogger();
      const teamEntry = makeRepoEntry({
        name: "acme/team-repo",
        linearTeam: "TeamX",
        assigneeMe: true,
      });
      const defaultEntry = makeRepoEntry({ name: "acme/default" });
      const registry = new RepoRegistry(
        root,
        { repos: [teamEntry, defaultEntry], defaultRepo: "acme/default" },
        logger as never,
      );

      const result = registry.resolveForIssue(undefined, "TeamX");
      expect(result).toEqual(teamEntry);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ team: "TeamX", repo: "acme/team-repo" }),
        "Resolved repo from Linear team",
      );
    });

    it("falls back to team routing when project is provided but unmatched, and team matches", () => {
      const logger = makeLogger();
      const teamEntry = makeRepoEntry({ name: "acme/team-repo", linearTeam: "TeamX" });
      const defaultEntry = makeRepoEntry({ name: "acme/default" });
      const registry = new RepoRegistry(
        root,
        { repos: [teamEntry, defaultEntry], defaultRepo: "acme/default" },
        logger as never,
      );

      const result = registry.resolveForIssue("UnknownProject", "TeamX");
      expect(result).toEqual(teamEntry);
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      const logger = makeLogger();
      const projectEntry = makeRepoEntry({ name: "acme/proj", linearProject: "Proj" });
      const defaultEntry = makeRepoEntry({ name: "acme/default" });
      const registry = new RepoRegistry(
        root,
        { repos: [projectEntry, defaultEntry], defaultRepo: "acme/default" },
        logger as never,
      );

      expect(() => registry.resolveForIssue("Unmapped", undefined)).toThrow(
        /No repo mapped to Linear project "Unmapped"\. Configured projects: \[Proj\]/,
      );
    });

    it("falls back to the default repo when neither project nor team are provided", () => {
      const logger = makeLogger();
      const defaultEntry = makeRepoEntry({ name: "acme/default" });
      const registry = new RepoRegistry(
        root,
        { repos: [defaultEntry], defaultRepo: "acme/default" },
        logger as never,
      );

      const result = registry.resolveForIssue(undefined, undefined);
      expect(result).toEqual(defaultEntry);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: "acme/default" }),
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when project and team are both unmatched", () => {
      const logger = makeLogger();
      const defaultEntry = makeRepoEntry({ name: "acme/default" });
      const registry = new RepoRegistry(
        root,
        { repos: [defaultEntry], defaultRepo: "acme/default" },
        logger as never,
      );

      // project is falsy-checked via `if (project)`; team provided but unmatched
      // and project unset takes the final default-fallback path.
      const result = registry.resolveForIssue(undefined, "NoSuchTeam");
      expect(result).toEqual(defaultEntry);
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against reposRootPath", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry({ name: "acme/widgets", directory: "widgets" });
      const registry = new RepoRegistry(
        root,
        { repos: [entry], defaultRepo: "acme/widgets" },
        logger as never,
      );

      expect(registry.resolveWorkingDirectory(entry)).toBe(join(root, "widgets"));
    });

    it("resolves an absolute directory as-is, ignoring reposRootPath", () => {
      const logger = makeLogger();
      const absoluteDir = join(root, "elsewhere", "widgets");
      const entry = makeRepoEntry({ name: "acme/widgets", directory: absoluteDir });
      const registry = new RepoRegistry(
        root,
        { repos: [entry], defaultRepo: "acme/widgets" },
        logger as never,
      );

      expect(registry.resolveWorkingDirectory(entry)).toBe(absoluteDir);
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry(
        root,
        { repos: [entry], defaultRepo: entry.name },
        logger as never,
      );
      const missing = join(root, "does-not-exist");

      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory exists but has no .git entry", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry(
        root,
        { repos: [entry], defaultRepo: entry.name },
        logger as never,
      );
      const dir = join(root, "not-a-repo");
      mkdirSync(dir);

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a working directory with a .git directory (normal clone)", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry(
        root,
        { repos: [entry], defaultRepo: entry.name },
        logger as never,
      );
      const dir = join(root, "cloned-repo");
      mkdirSync(join(dir, ".git"), { recursive: true });

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("accepts a working directory with a .git file (worktree)", () => {
      const logger = makeLogger();
      const entry = makeRepoEntry();
      const registry = new RepoRegistry(
        root,
        { repos: [entry], defaultRepo: entry.name },
        logger as never,
      );
      const dir = join(root, "worktree-repo");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".git"), "gitdir: /somewhere/.git/worktrees/worktree-repo\n");

      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads a registry from a valid config file", () => {
    const logger = makeLogger();
    const configPath = join(root, "repos.config.json");
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "acme/widgets" })],
      defaultRepo: "acme/widgets",
    };
    writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const registry = loadRepoRegistry(configPath, root, logger as never);

    expect(registry.getRepoByName("acme/widgets")).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, repoCount: 1, defaultRepo: "acme/widgets" }),
      "Loaded repo registry",
    );
  });

  it("applies the defaultBranch default of 'main' when omitted", () => {
    const logger = makeLogger();
    const configPath = join(root, "repos.config.json");
    const rawConfig = {
      repos: [
        {
          name: "acme/widgets",
          directory: "widgets",
          allowedPaths: [],
          protectedPaths: [],
          constraints: makeConstraints(),
        },
      ],
      defaultRepo: "acme/widgets",
    };
    writeFileSync(configPath, JSON.stringify(rawConfig), "utf-8");

    const registry = loadRepoRegistry(configPath, root, logger as never);

    expect(registry.getRepoByName("acme/widgets")?.defaultBranch).toBe("main");
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const logger = makeLogger();
    const configPath = join(root, "repos.config.json");
    const examplePath = join(root, "repos.config.example.json");
    const config: ReposConfig = {
      repos: [makeRepoEntry({ name: "acme/example-repo" })],
      defaultRepo: "acme/example-repo",
    };
    writeFileSync(examplePath, JSON.stringify(config), "utf-8");
    // Note: configPath itself is never written.

    const registry = loadRepoRegistry(configPath, root, logger as never);

    expect(registry.getRepoByName("acme/example-repo")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the config path nor its example fallback exist", () => {
    const logger = makeLogger();
    const configPath = join(root, "missing.config.json");

    expect(() => loadRepoRegistry(configPath, root, logger as never)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a Zod validation error when the config file content is invalid", () => {
    const logger = makeLogger();
    const configPath = join(root, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "x" }), "utf-8");

    // repos must have min(1) entry.
    expect(() => loadRepoRegistry(configPath, root, logger as never)).toThrow();
  });

  it("throws a JSON parse error when the config file content is not valid JSON", () => {
    const logger = makeLogger();
    const configPath = join(root, "repos.config.json");
    writeFileSync(configPath, "{ not valid json", "utf-8");

    expect(() => loadRepoRegistry(configPath, root, logger as never)).toThrow();
  });
});
