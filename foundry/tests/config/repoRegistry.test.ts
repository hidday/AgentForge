import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepoRegistry,
  loadRepoRegistry,
  type ReposConfig,
  type RepoEntry,
} from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn(actual.statSync) };
});

import { statSync } from "node:fs";
const mockedStatSync = vi.mocked(statSync);

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
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
    protectedPaths: [],
    constraints: makeConstraints(),
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe("construction", () => {
    it("throws when defaultRepo does not match any configured repo", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "does-not-exist",
      };
      expect(() => new RepoRegistry("/root", config, logger)).toThrow(
        /Default repo "does-not-exist" not found in registry. Available: repo-a/,
      );
    });

    it("indexes repos by linearProject and linearTeam when provided", () => {
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-a", linearProject: "proj-a" }),
          makeRepoEntry({ name: "repo-b", linearTeam: "team-b" }),
        ],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/root", config, logger);
      expect(registry.getRepoByLinearProject("proj-a")?.name).toBe("repo-a");
      expect(registry.getRepoByLinearProject("missing")).toBeUndefined();
    });
  });

  describe("getRepoByName / getDefaultRepo", () => {
    it("returns the matching repo entry for a known name", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/root", config, logger);
      expect(registry.getRepoByName("repo-b")?.name).toBe("repo-b");
    });

    it("returns undefined for an unknown repo name", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/root", config, logger);
      expect(registry.getRepoByName("nope")).toBeUndefined();
    });

    it("returns the configured default repo entry", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
        defaultRepo: "repo-b",
      };
      const registry = new RepoRegistry("/root", config, logger);
      expect(registry.getDefaultRepo().name).toBe("repo-b");
    });

    it("listRepos returns all configured entries", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" }), makeRepoEntry({ name: "repo-b" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/root", config, logger);
      expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("resolveForIssue", () => {
    function buildRegistry() {
      const config: ReposConfig = {
        repos: [
          makeRepoEntry({ name: "repo-proj", linearProject: "proj-a" }),
          makeRepoEntry({ name: "repo-team", linearTeam: "team-b", assigneeMe: true }),
          makeRepoEntry({ name: "repo-default" }),
        ],
        defaultRepo: "repo-default",
      };
      return new RepoRegistry("/root", config, logger);
    }

    it("resolves by exact Linear project match", () => {
      const registry = buildRegistry();
      const entry = registry.resolveForIssue("proj-a", undefined);
      expect(entry.name).toBe("repo-proj");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "proj-a", repo: "repo-proj" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when project does not match but team does", () => {
      const registry = buildRegistry();
      const entry = registry.resolveForIssue(undefined, "team-b");
      expect(entry.name).toBe("repo-team");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "team-b", repo: "repo-team" },
        "Resolved repo from Linear team",
      );
    });

    it("prefers project match over team when both are given and project matches", () => {
      const registry = buildRegistry();
      const entry = registry.resolveForIssue("proj-a", "team-b");
      expect(entry.name).toBe("repo-proj");
    });

    it("falls back to team when project is given but unmatched, and team matches", () => {
      const registry = buildRegistry();
      const entry = registry.resolveForIssue("unknown-project", "team-b");
      expect(entry.name).toBe("repo-team");
    });

    it("throws when project is given, unmatched, and no team is provided", () => {
      const registry = buildRegistry();
      expect(() => registry.resolveForIssue("unknown-project", undefined)).toThrow(
        /No repo mapped to Linear project "unknown-project"/,
      );
    });

    it("throws listing configured projects when project is given and unmatched with no team", () => {
      const registry = buildRegistry();
      expect(() => registry.resolveForIssue("unknown-project")).toThrow(/proj-a/);
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = buildRegistry();
      const entry = registry.resolveForIssue(undefined, undefined);
      expect(entry.name).toBe("repo-default");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "repo-default" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when project and team are both given but neither matches", () => {
      const registry = buildRegistry();
      // project given+unmatched with a team given but also unmatched -> falls through to default
      const entry = registry.resolveForIssue("unknown-project", "unknown-team");
      expect(entry.name).toBe("repo-default");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is (normalized)", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a", directory: "/abs/path/repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/root", config, logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo-a");
    });

    it("resolves a relative directory against the repos root path", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a", directory: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry("/root/workspace", config, logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/root/workspace/repo-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("throws when the working directory does not exist", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(tmpRoot, config, logger);
      const missing = join(tmpRoot, "does-not-exist");
      expect(() => registry.validateWorkingDirectory(missing)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(tmpRoot, config, logger);
      const dir = join(tmpRoot, "no-git");
      mkdirSync(dir);
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("succeeds when .git is a directory (a normal clone)", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(tmpRoot, config, logger);
      const dir = join(tmpRoot, "normal-clone");
      mkdirSync(dir);
      mkdirSync(join(dir, ".git"));
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("succeeds when .git is a file (a worktree)", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(tmpRoot, config, logger);
      const dir = join(tmpRoot, "worktree");
      mkdirSync(dir);
      writeFileSync(join(dir, ".git"), "gitdir: /some/other/path\n");
      expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
    });

    it("throws when the .git entry is neither a file nor a directory (e.g. a special fs entry)", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(tmpRoot, config, logger);
      const dir = join(tmpRoot, "weird-git-entry");
      mkdirSync(dir);
      mkdirSync(join(dir, ".git"));

      // Simulate a .git entry that is some special fs object (socket, device,
      // etc.) that is neither a regular file nor a directory -- a real
      // filesystem edge case that is impractical to construct directly in a
      // portable test, so we stub statSync's result for just this call.
      mockedStatSync.mockImplementationOnce(
        () =>
          ({
            isDirectory: () => false,
            isFile: () => false,
          }) as ReturnType<typeof import("node:fs").statSync>,
      );

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      const config: ReposConfig = {
        repos: [makeRepoEntry({ name: "repo-a" })],
        defaultRepo: "repo-a",
      };
      const registry = new RepoRegistry(tmpRoot, config, logger);
      const dir = join(tmpRoot, "final-check");
      mkdirSync(dir);
      mkdirSync(join(dir, ".git"));

      // First statSync call is for the .git entry (must look like a normal
      // directory to pass that guard); the second is for workingDirectory
      // itself, which we make report as "not a directory" to exercise the
      // final boundary check.
      mockedStatSync
        .mockImplementationOnce(() => ({ isDirectory: () => true, isFile: () => false }) as ReturnType<
          typeof import("node:fs").statSync
        >)
        .mockImplementationOnce(
          () => ({ isDirectory: () => false, isFile: () => false }) as ReturnType<
            typeof import("node:fs").statSync
          >,
        );

      expect(() => registry.validateWorkingDirectory(dir)).toThrow(
        /Working directory path is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  let tmpRoot: string;
  let logger: Logger;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "repo-registry-load-test-"));
    logger = makeLogger();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeConfig(path: string, config: unknown) {
    writeFileSync(path, JSON.stringify(config), "utf-8");
  }

  it("loads a registry from an existing config file and logs success", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    const config = {
      repos: [
        {
          name: "repo-a",
          directory: "repo-a",
          allowedPaths: ["src/"],
          protectedPaths: [],
          constraints: makeConstraints(),
        },
      ],
      defaultRepo: "repo-a",
    };
    writeConfig(configPath, config);

    const registry = loadRepoRegistry(configPath, tmpRoot, logger);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json file when the configured path is missing, and warns", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    const examplePath = join(tmpRoot, "repos.config.example.json");
    const config = {
      repos: [
        {
          name: "repo-example",
          directory: "repo-example",
          allowedPaths: ["src/"],
          protectedPaths: [],
          constraints: makeConstraints(),
        },
      ],
      defaultRepo: "repo-example",
    };
    writeConfig(examplePath, config);

    const registry = loadRepoRegistry(configPath, tmpRoot, logger);
    expect(registry.getDefaultRepo().name).toBe("repo-example");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expected: configPath, fallback: examplePath }),
      expect.stringContaining("repos.config.json not found"),
    );
  });

  it("throws when neither the configured path nor the example fallback exist", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, tmpRoot, logger)).toThrow(
      /Repo config not found at/,
    );
  });

  it("throws a zod validation error when the config file is malformed", () => {
    const configPath = join(tmpRoot, "repos.config.json");
    writeConfig(configPath, { repos: [], defaultRepo: "repo-a" });
    expect(() => loadRepoRegistry(configPath, tmpRoot, logger)).toThrow();
  });
});
