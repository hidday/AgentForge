import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

const readFileSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const statSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  statSync: (...args: unknown[]) => statSyncMock(...args),
}));

import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const constraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

const validConfig: ReposConfig = {
  repos: [
    {
      name: "repo-a",
      directory: "repo-a",
      linearProject: "Project A",
      linearTeam: "TeamA",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
      constraints,
    },
    {
      name: "repo-b",
      directory: "/abs/repo-b",
      defaultBranch: "main",
      allowedPaths: [],
      protectedPaths: [],
      constraints,
    },
  ],
  defaultRepo: "repo-a",
};

describe("RepoRegistry", () => {
  const logger = makeLogger();

  describe("constructor", () => {
    it("throws a clear error when defaultRepo is not present among repos", () => {
      const badConfig: ReposConfig = { ...validConfig, defaultRepo: "does-not-exist" };
      expect(() => new RepoRegistry("/root", badConfig, logger as never)).toThrow(
        /Default repo "does-not-exist" not found in registry. Available: repo-a, repo-b/,
      );
    });
  });

  describe("getRepoByName / getDefaultRepo / listRepos", () => {
    const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);

    it("returns the matching entry by name", () => {
      expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    });

    it("returns undefined for an unknown name", () => {
      expect(registry.getRepoByName("unknown")).toBeUndefined();
    });

    it("returns the configured default repo", () => {
      expect(registry.getDefaultRepo().name).toBe("repo-a");
    });

    it("lists all repo entries", () => {
      const repos = registry.listRepos();
      expect(repos).toHaveLength(2);
      expect(repos.map((r) => r.name)).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("getRepoByLinearProject", () => {
    const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);

    it("returns the entry mapped to a Linear project", () => {
      expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    });

    it("returns undefined for an unmapped project", () => {
      expect(registry.getRepoByLinearProject("Unmapped")).toBeUndefined();
    });
  });

  describe("resolveForIssue", () => {
    it("resolves via exact Linear project match", () => {
      const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);
      const entry = registry.resolveForIssue("Project A", undefined);
      expect(entry.name).toBe("repo-a");
    });

    it("resolves via Linear team match when project does not match", () => {
      const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);
      const entry = registry.resolveForIssue(undefined, "TeamA");
      expect(entry.name).toBe("repo-a");
    });

    it("throws when a project is given but unmatched and no team is provided", () => {
      const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);
      expect(() => registry.resolveForIssue("Unmapped Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unmapped Project"/,
      );
    });

    it("falls back to team routing when project is unmatched but team matches", () => {
      const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);
      const entry = registry.resolveForIssue("Unmapped Project", "TeamA");
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to the default repo when neither project nor team is provided", () => {
      const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);
      const entry = registry.resolveForIssue(undefined, undefined);
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to the default repo when team is provided but unmatched and no project given", () => {
      const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);
      const entry = registry.resolveForIssue(undefined, "UnmatchedTeam");
      expect(entry.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);

    it("resolves a relative directory against the repos root path", () => {
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/root", "repo-a"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const entry = registry.getRepoByName("repo-b")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/repo-b");
    });
  });

  describe("validateWorkingDirectory", () => {
    const registry = new RepoRegistry("/root", validConfig, makeLogger() as never);

    beforeEach(() => {
      existsSyncMock.mockReset();
      statSyncMock.mockReset();
    });

    it("throws when the working directory does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      expect(() => registry.validateWorkingDirectory("/does/not/exist")).toThrow(
        /Working directory does not exist: \/does\/not\/exist/,
      );
    });

    it("throws when the .git entry is missing", () => {
      existsSyncMock.mockImplementation((p: string) => p === "/repo");
      expect(() => registry.validateWorkingDirectory("/repo")).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when .git exists but is neither a directory nor a file", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/repo", ".git")) {
          return { isDirectory: () => false, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory("/repo")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/repo", ".git")) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => true };
      });
      expect(() => registry.validateWorkingDirectory("/repo")).toThrow(
        /Working directory path is not a directory: \/repo/,
      );
    });

    it("passes for a normal clone with a .git directory", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockReturnValue({ isDirectory: () => true, isFile: () => false });
      expect(() => registry.validateWorkingDirectory("/repo")).not.toThrow();
    });

    it("passes for a worktree with a .git file", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => {
        if (p === join("/repo", ".git")) {
          return { isDirectory: () => false, isFile: () => true };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory("/repo")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  const logger = makeLogger();

  beforeEach(() => {
    readFileSyncMock.mockReset();
    existsSyncMock.mockReset();
    statSyncMock.mockReset();
  });

  it("loads a valid config from the resolved path", () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith("repos.config.json"));
    readFileSyncMock.mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRepoRegistry("repos.config.json", "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos()).toHaveLength(2);
  });

  it("throws a validation error for a malformed config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));

    expect(() => loadRepoRegistry("repos.config.json", "/root", logger as never)).toThrow();
  });

  it("throws when the JSON itself is invalid", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("{ not valid json");

    expect(() => loadRepoRegistry("repos.config.json", "/root", logger as never)).toThrow();
  });

  it("falls back to the example config when the primary file is missing but example exists", () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith(".example.json"));
    readFileSyncMock.mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRepoRegistry("repos.config.json", "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("throws when neither the primary file nor the example fallback exist", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() => loadRepoRegistry("repos.config.json", "/root", logger as never)).toThrow(
      /Repo config not found at/,
    );
  });
});
