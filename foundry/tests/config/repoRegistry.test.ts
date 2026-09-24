import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

const { loadRepoRegistry, RepoRegistry } = await import("../../src/config/repoRegistry.js");
type RepoEntryLike = {
  name: string;
  directory: string;
  linearProject?: string;
  linearTeam?: string;
  assigneeMe?: boolean;
  defaultBranch?: string;
  allowedPaths: string[];
  protectedPaths: string[];
  constraints: {
    requiredChecks: string[];
    maxFilesChanged: number;
    maxDiffLines: number;
    forbiddenPatterns: string[];
    mustNotTouch: string[];
  };
};

function makeConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["console.log"],
    mustNotTouch: [".github/"],
  };
}

function makeRepoEntry(overrides: Partial<RepoEntryLike> = {}): RepoEntryLike {
  return {
    name: "main-repo",
    directory: "./main-repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: makeConstraints(),
    ...overrides,
  };
}

function makeValidConfigJson(overrides: Partial<{ repos: RepoEntryLike[]; defaultRepo: string }> = {}) {
  return JSON.stringify({
    repos: [makeRepoEntry()],
    defaultRepo: "main-repo",
    ...overrides,
  });
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  mockReadFileSync.mockReset();
  mockExistsSync.mockReset();
  mockStatSync.mockReset();
});

describe("loadRepoRegistry", () => {
  it("loads a valid config from the given path", () => {
    const logger = makeLogger();
    mockExistsSync.mockImplementation((p: string) => p === "/cfg/repos.config.json");
    mockReadFileSync.mockReturnValue(makeValidConfigJson());

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/repos-root", logger);

    expect(registry).toBeInstanceOf(RepoRegistry);
    expect(registry.getRepoByName("main-repo")?.name).toBe("main-repo");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 1, defaultRepo: "main-repo" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the example config when the primary file is missing", () => {
    const logger = makeLogger();
    mockExistsSync.mockImplementation(
      (p: string) => p === "/cfg/repos.config.example.json",
    );
    mockReadFileSync.mockReturnValue(makeValidConfigJson());

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/repos-root", logger);

    expect(registry.getDefaultRepo().name).toBe("main-repo");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: "/cfg/repos.config.json",
        fallback: "/cfg/repos.config.example.json",
      }),
      expect.stringContaining("falling back to the committed example"),
    );
    expect(mockReadFileSync).toHaveBeenCalledWith("/cfg/repos.config.example.json", "utf-8");
  });

  it("throws when neither the config file nor the example fallback exist", () => {
    const logger = makeLogger();
    mockExistsSync.mockReturnValue(false);

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/repos-root", logger)).toThrow(
      /Repo config not found at \/cfg\/repos\.config\.json/,
    );
  });

  it("throws on malformed (non-JSON) config content", () => {
    const logger = makeLogger();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{ this is not valid json");

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/repos-root", logger)).toThrow();
  });

  it("throws a schema validation error on structurally invalid config", () => {
    const logger = makeLogger();
    mockExistsSync.mockReturnValue(true);
    // repos must have at least one entry
    mockReadFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "main-repo" }));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/repos-root", logger)).toThrow();
  });

  it("throws a schema validation error when a repo entry is missing required fields", () => {
    const logger = makeLogger();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        repos: [{ name: "broken-repo" }],
        defaultRepo: "broken-repo",
      }),
    );

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/repos-root", logger)).toThrow();
  });
});

describe("RepoRegistry", () => {
  const logger = makeLogger();

  function makeRegistry(entries: RepoEntryLike[], defaultRepo: string) {
    return new RepoRegistry(
      "/repos-root",
      { repos: entries as never, defaultRepo },
      logger,
    );
  }

  beforeEach(() => {
    logger.debug.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
  });

  it("throws when constructed with a defaultRepo not present in the entries", () => {
    expect(() =>
      makeRegistry([makeRepoEntry({ name: "a" })], "does-not-exist"),
    ).toThrow(/Default repo "does-not-exist" not found in registry/);
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const registry = makeRegistry([makeRepoEntry({ name: "a" })], "a");
    expect(registry.getRepoByName("a")?.name).toBe("a");
    expect(registry.getRepoByName("missing")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const registry = makeRegistry(
      [makeRepoEntry({ name: "a", linearProject: "Proj X" })],
      "a",
    );
    expect(registry.getRepoByLinearProject("Proj X")?.name).toBe("a");
    expect(registry.getRepoByLinearProject("Proj Y")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const registry = makeRegistry(
      [makeRepoEntry({ name: "a" }), makeRepoEntry({ name: "b" })],
      "b",
    );
    expect(registry.getDefaultRepo().name).toBe("b");
  });

  it("listRepos returns all registered entries", () => {
    const registry = makeRegistry(
      [makeRepoEntry({ name: "a" }), makeRepoEntry({ name: "b" })],
      "a",
    );
    expect(registry.listRepos().map((r) => r.name).sort()).toEqual(["a", "b"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match", () => {
      const registry = makeRegistry(
        [
          makeRepoEntry({ name: "a" }),
          makeRepoEntry({ name: "b", linearProject: "Proj X" }),
        ],
        "a",
      );
      const resolved = registry.resolveForIssue("Proj X", undefined);
      expect(resolved.name).toBe("b");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Proj X", repo: "b" },
        "Resolved repo from Linear project",
      );
    });

    it("resolves by Linear team match when no project match is found", () => {
      const registry = makeRegistry(
        [
          makeRepoEntry({ name: "a" }),
          makeRepoEntry({ name: "b", linearTeam: "Team X", assigneeMe: true }),
        ],
        "a",
      );
      const resolved = registry.resolveForIssue(undefined, "Team X");
      expect(resolved.name).toBe("b");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "Team X", repo: "b" },
        "Resolved repo from Linear team",
      );
    });

    it("throws when a project is given, unmatched, and no team fallback is provided", () => {
      const registry = makeRegistry(
        [makeRepoEntry({ name: "a", linearProject: "Known Project" })],
        "a",
      );
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to the default repo when project and team are both unmatched", () => {
      const registry = makeRegistry(
        [
          makeRepoEntry({ name: "a" }),
          makeRepoEntry({ name: "b", linearProject: "Known Project" }),
        ],
        "a",
      );
      const resolved = registry.resolveForIssue("Unknown Project", "Unknown Team");
      expect(resolved.name).toBe("a");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "a" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team are provided", () => {
      const registry = makeRegistry([makeRepoEntry({ name: "a" })], "a");
      const resolved = registry.resolveForIssue();
      expect(resolved.name).toBe("a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("returns the resolved absolute path when directory is already absolute", () => {
      const registry = makeRegistry(
        [makeRepoEntry({ name: "a", directory: "/abs/path/repo" })],
        "a",
      );
      const entry = registry.getRepoByName("a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/path/repo");
    });

    it("joins a relative directory onto the repos root path", () => {
      const registry = makeRegistry(
        [makeRepoEntry({ name: "a", directory: "sub/repo" })],
        "a",
      );
      const entry = registry.getRepoByName("a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "sub/repo"));
    });
  });

  describe("validateWorkingDirectory", () => {
    const registry = makeRegistry([makeRepoEntry({ name: "a" })], "a");
    const workingDirectory = "/work/dir";
    const gitDir = join(workingDirectory, ".git");

    it("throws when the working directory does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the working directory has no .git entry", () => {
      mockExistsSync.mockImplementation((p: string) => p === workingDirectory);
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when the .git entry is neither a directory nor a file", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p === gitDir) return { isDirectory: () => false, isFile: () => false };
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p === gitDir) return { isDirectory: () => true, isFile: () => false };
        return { isDirectory: () => false, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        /Working directory path is not a directory/,
      );
    });

    it("passes validation for a normal clone (.git directory)", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p === gitDir) return { isDirectory: () => true, isFile: () => false };
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).not.toThrow();
    });

    it("passes validation for a worktree (.git file)", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation((p: string) => {
        if (p === gitDir) return { isDirectory: () => false, isFile: () => true };
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).not.toThrow();
    });
  });
});
