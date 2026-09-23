import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

const readFileSync = vi.fn();
const existsSync = vi.fn();
const statSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => readFileSync(...args),
  existsSync: (...args: unknown[]) => existsSync(...args),
  statSync: (...args: unknown[]) => statSync(...args),
}));

type RepoRegistryType = InstanceType<typeof RepoRegistry>;
type ReposConfigType = ReposConfig;

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const baseConstraints = {
  requiredChecks: ["ci"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

function makeConfig(overrides: Partial<ReposConfigType> = {}) {
  return {
    repos: [
      {
        name: "widgets",
        directory: "widgets-repo",
        linearProject: "Widgets Project",
        linearTeam: "WID",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["src/**"],
        protectedPaths: ["prisma/**"],
        constraints: baseConstraints,
      },
      {
        name: "gadgets",
        directory: "/abs/gadgets-repo",
        defaultBranch: "main",
        allowedPaths: [],
        protectedPaths: [],
        constraints: baseConstraints,
      },
    ],
    defaultRepo: "widgets",
    ...overrides,
  } as unknown as ReposConfigType;
}

describe("RepoRegistry", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    readFileSync.mockReset();
    existsSync.mockReset();
    statSync.mockReset();
  });

  describe("constructor", () => {
    it("indexes repos by name, linearProject, and linearTeam", () => {
      const registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
      expect(registry.getRepoByName("widgets")?.name).toBe("widgets");
      expect(registry.getRepoByName("gadgets")?.name).toBe("gadgets");
      expect(registry.getRepoByName("missing")).toBeUndefined();
      expect(registry.getRepoByLinearProject("Widgets Project")?.name).toBe("widgets");
      expect(registry.getRepoByLinearProject("nope")).toBeUndefined();
      expect(registry.getDefaultRepo().name).toBe("widgets");
    });

    it("throws when defaultRepo does not match any configured repo", () => {
      expect(
        () => new RepoRegistry("/repos-root", makeConfig({ defaultRepo: "nonexistent" }), logger as never),
      ).toThrow(/Default repo "nonexistent" not found in registry\. Available: widgets, gadgets/);
    });
  });

  describe("resolveForIssue", () => {
    let registry: RepoRegistryType;

    beforeEach(() => {
      registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
    });

    it("resolves by exact Linear project match first", () => {
      const entry = registry.resolveForIssue("Widgets Project", undefined);
      expect(entry.name).toBe("widgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { project: "Widgets Project", repo: "widgets" },
        "Resolved repo from Linear project",
      );
    });

    it("falls back to team-based routing when there is no project", () => {
      const entry = registry.resolveForIssue(undefined, "WID");
      expect(entry.name).toBe("widgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { team: "WID", repo: "widgets" },
        "Resolved repo from Linear team",
      );
    });

    it("falls back to team-based routing when the project is unmatched", () => {
      const entry = registry.resolveForIssue("Unknown Project", "WID");
      expect(entry.name).toBe("widgets");
    });

    it("throws when project is provided, unmatched, and no team is given", () => {
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"\. Configured projects: \[Widgets Project\]/,
      );
    });

    it("falls back to the default repo when project is unmatched and team is also unmatched", () => {
      const entry = registry.resolveForIssue("Unknown Project", "UNKNOWN_TEAM");
      expect(entry.name).toBe("widgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "widgets" },
        "Issue has no Linear project or team match, using default repo",
      );
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("widgets");
      expect(logger.debug).toHaveBeenCalledWith(
        { fallback: "widgets" },
        "Issue has no Linear project or team match, using default repo",
      );
    });
  });

  describe("resolveWorkingDirectory", () => {
    let registry: RepoRegistryType;

    beforeEach(() => {
      registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
    });

    it("returns the directory as-is (resolved) when it is already absolute", () => {
      const entry = registry.getRepoByName("gadgets")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/gadgets-repo");
    });

    it("joins with the repos root when the directory is relative", () => {
      const entry = registry.getRepoByName("widgets")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/repos-root/widgets-repo");
    });
  });

  describe("validateWorkingDirectory", () => {
    let registry: RepoRegistryType;
    const workingDirectory = "/repos-root/widgets-repo";
    const gitDir = join(workingDirectory, ".git");

    beforeEach(() => {
      registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
    });

    it("throws when the working directory does not exist", () => {
      existsSync.mockReturnValue(false);
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        `Working directory does not exist: ${workingDirectory}.`,
      );
    });

    it("throws when there is no .git entry", () => {
      existsSync.mockImplementation((p: string) => p === workingDirectory);
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        `Working directory is not a git repository: ${workingDirectory}.`,
      );
    });

    it("throws when the .git entry is neither a directory nor a file", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) => {
        if (p === gitDir) {
          return { isDirectory: () => false, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        `Working directory has invalid .git entry: ${gitDir}.`,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) => {
        if (p === gitDir) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => false, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).toThrow(
        `Working directory path is not a directory: ${workingDirectory}.`,
      );
    });

    it("succeeds when .git is a normal directory clone", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) => {
        if (p === gitDir) {
          return { isDirectory: () => true, isFile: () => false };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).not.toThrow();
    });

    it("succeeds when .git is a file (worktree)", () => {
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p: string) => {
        if (p === gitDir) {
          return { isDirectory: () => false, isFile: () => true };
        }
        return { isDirectory: () => true, isFile: () => false };
      });
      expect(() => registry.validateWorkingDirectory(workingDirectory)).not.toThrow();
    });
  });

  describe("listRepos", () => {
    it("returns all configured repo entries", () => {
      const registry = new RepoRegistry("/repos-root", makeConfig(), logger as never);
      const repos = registry.listRepos();
      expect(repos.map((r) => r.name).sort()).toEqual(["gadgets", "widgets"]);
    });
  });
});

describe("loadRepoRegistry", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    readFileSync.mockReset();
    existsSync.mockReset();
    statSync.mockReset();
  });

  it("loads and parses the config when the configured path exists", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry("./repos.config.json", "/repos-root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("widgets");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "widgets" }),
      "Loaded repo registry",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the .example.json file when the configured path is missing", () => {
    existsSync.mockImplementation((p: string) => p.endsWith(".example.json"));
    readFileSync.mockReturnValue(JSON.stringify(makeConfig()));

    const registry = loadRepoRegistry("./repos.config.json", "/repos-root", logger as never);

    expect(registry.getDefaultRepo().name).toBe("widgets");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.stringContaining("repos.config.json"),
        fallback: expect.stringContaining("repos.config.example.json"),
      }),
      expect.stringContaining("repos.config.json not found"),
    );
    expect(readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("repos.config.example.json"),
      "utf-8",
    );
  });

  it("throws when neither the configured path nor the example file exist", () => {
    existsSync.mockReturnValue(false);
    expect(() => loadRepoRegistry("./repos.config.json", "/repos-root", logger as never)).toThrow(
      /Repo config not found at .*repos\.config\.json and no example fallback at .*repos\.config\.example\.json/,
    );
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("throws a schema validation error when the file contents are invalid", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "widgets" }));
    expect(() => loadRepoRegistry("./repos.config.json", "/repos-root", logger as never)).toThrow();
  });
});
