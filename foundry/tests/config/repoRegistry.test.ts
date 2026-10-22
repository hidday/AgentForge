import { describe, it, expect, vi, beforeEach } from "vitest";

const { readFileSyncMock, existsSyncMock, statSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
  existsSync: existsSyncMock,
  statSync: statSyncMock,
}));

import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    defaultRepo: "repo-a",
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        linearProject: "Platform",
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
        directory: "/abs/repo-b",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        assigneeMe: true,
        linearTeam: "ENG",
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 1000,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the configured defaultRepo is not among the entries", () => {
    const logger = makeLogger();
    expect(
      () => new RepoRegistry("/root", makeConfig({ defaultRepo: "missing" }), logger as never),
    ).toThrow(/Default repo "missing" not found/);
  });

  it("getRepoByName / getDefaultRepo / listRepos return the expected entries", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(registry.listRepos()).toHaveLength(2);
  });

  it("getRepoByLinearProject resolves a repo indexed by linearProject", () => {
    const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByLinearProject("Platform")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("Unknown")).toBeUndefined();
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue("Platform", "ENG").name).toBe("repo-a");
    });

    it("falls back to team-based routing when project is unset", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue(undefined, "ENG").name).toBe("repo-b");
    });

    it("throws when a project is given but unmatched and no team is given", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project is unmatched but a team is also given with no match", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue("Unknown Project", "Unknown Team").name).toBe("repo-a");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue().name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("joins a relative directory under the repos root", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/root/repo-a");
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      const entry = registry.getRepoByName("repo-b")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/repo-b");
    });
  });

  describe("validateWorkingDirectory", () => {
    it("throws when the working directory does not exist", () => {
      existsSyncMock.mockReturnValue(false);
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /does not exist/,
      );
    });

    it("throws when .git is missing", () => {
      existsSyncMock.mockImplementation((p: string) => !p.endsWith(".git"));
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /not a git repository/,
      );
    });

    it("passes when .git is a directory (normal clone)", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) => ({
        isDirectory: () => true,
        isFile: () => false,
      }));
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).not.toThrow();
    });

    it("passes when .git is a file (worktree)", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) =>
        p.endsWith(".git")
          ? { isDirectory: () => false, isFile: () => true }
          : { isDirectory: () => true, isFile: () => false },
      );
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).not.toThrow();
    });

    it("throws when the top-level path exists but is not a directory", () => {
      existsSyncMock.mockReturnValue(true);
      statSyncMock.mockImplementation((p: string) =>
        p.endsWith(".git")
          ? { isDirectory: () => true, isFile: () => false }
          : { isDirectory: () => false, isFile: () => false },
      );
      const registry = new RepoRegistry("/root", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and parses the config file when it exists at the given path", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/config/repos.config.json", "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the .example.json file with a warning when the real config is missing", () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith(".example.json"));
    readFileSyncMock.mockReturnValue(JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry("/config/repos.config.json", "/root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("throws when neither the config nor the example fallback exist", () => {
    existsSyncMock.mockReturnValue(false);
    expect(() =>
      loadRepoRegistry("/config/repos.config.json", "/root", makeLogger() as never),
    ).toThrow(/Repo config not found/);
  });

  it("throws when the parsed JSON fails schema validation", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "x" }));
    expect(() =>
      loadRepoRegistry("/config/repos.config.json", "/root", makeLogger() as never),
    ).toThrow();
  });
});
