import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileSync = vi.fn();
const existsSync = vi.fn();
const statSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => readFileSync(...args),
  existsSync: (...args: unknown[]) => existsSync(...args),
  statSync: (...args: unknown[]) => statSync(...args),
}));

import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const baseConstraints = {
  requiredChecks: [],
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
        linearTeam: "TEAM-A",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: baseConstraints,
      },
      {
        name: "repo-b",
        directory: "/abs/repo-b",
        defaultBranch: "master",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: baseConstraints,
      },
    ],
    defaultRepo: "repo-b",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    readFileSync.mockReset();
    existsSync.mockReset();
    statSync.mockReset();
  });

  it("throws at construction when the default repo is not found", () => {
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "missing" }), logger),
    ).toThrow(/Default repo "missing" not found/);
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const registry = new RepoRegistry("/root", makeConfig(), logger);
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const registry = new RepoRegistry("/root", makeConfig(), logger);
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const registry = new RepoRegistry("/root", makeConfig(), logger);
    expect(registry.getDefaultRepo().name).toBe("repo-b");
  });

  it("listRepos returns all configured entries", () => {
    const registry = new RepoRegistry("/root", makeConfig(), logger);
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["repo-a", "repo-b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(registry.resolveForIssue("Project A", "TEAM-A").name).toBe("repo-a");
    });

    it("falls back to team-based routing when the project does not match", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(registry.resolveForIssue(undefined, "TEAM-A").name).toBe("repo-a");
    });

    it("throws when a project is given but unmatched and there is no team fallback", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(registry.resolveForIssue().name).toBe("repo-b");
    });

    it("falls back to the default repo when project is unmatched but a team is also unmatched", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(registry.resolveForIssue("Unknown Project", "unknown-team").name).toBe("repo-b");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves an absolute directory as-is", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      const entry = registry.getRepoByName("repo-b")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/repo-b");
    });

    it("joins a relative directory with the repos root path", () => {
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/root/repo-a");
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      existsSync.mockReturnValue(false);
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when there is no .git entry", () => {
      existsSync.mockImplementation((p: string) => !p.endsWith(".git"));
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /is not a git repository/,
      );
    });

    it("throws when the .git entry is neither a file nor a directory", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) =>
        p.endsWith(".git")
          ? { isDirectory: () => false, isFile: () => false }
          : { isDirectory: () => true },
      );
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) =>
        p.endsWith(".git")
          ? { isDirectory: () => true, isFile: () => false }
          : { isDirectory: () => false },
      );
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /is not a directory/,
      );
    });

    it("passes for a well-formed git working directory", () => {
      existsSync.mockReturnValue(true);
      statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).not.toThrow();
    });

    it("accepts a .git entry that is a file (worktree layout)", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) =>
        p.endsWith(".git")
          ? { isDirectory: () => false, isFile: () => true }
          : { isDirectory: () => true },
      );
      const registry = new RepoRegistry("/root", makeConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    readFileSync.mockReset();
    existsSync.mockReset();
    statSync.mockReset();
  });

  it("loads config directly when the configured path exists", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry("/root/repos.config.json", "/root", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.info).toHaveBeenCalled();
  });

  it("falls back to the example config with a warning when the real path is missing", () => {
    existsSync.mockImplementation((p: string) => p.endsWith(".example.json"));
    readFileSync.mockReturnValue(JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry("/root/repos.config.json", "/root", logger);

    expect(registry.getDefaultRepo().name).toBe("repo-b");
    expect(logger.warn).toHaveBeenCalled();
    expect(readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("repos.config.example.json"),
      "utf-8",
    );
  });

  it("throws when neither the real config nor the example fallback exists", () => {
    existsSync.mockReturnValue(false);

    expect(() => loadRepoRegistry("/root/repos.config.json", "/root", logger)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the file content fails schema validation", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry("/root/repos.config.json", "/root", logger)).toThrow();
  });
});
