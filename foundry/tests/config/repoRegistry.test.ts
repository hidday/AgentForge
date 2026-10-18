import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import type { Logger } from "../../src/utils/logger.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync, existsSync, statSync } from "node:fs";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

const mockedReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockedExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockedStatSync = statSync as unknown as ReturnType<typeof vi.fn>;

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function validConfig(): ReposConfig {
  return {
    repos: [
      {
        name: "repo-a",
        directory: "repo-a",
        linearProject: "Project A",
        linearTeam: undefined,
        assigneeMe: undefined,
        defaultBranch: "main",
        allowedPaths: ["src/**"],
        protectedPaths: ["src/generated/**"],
        constraints: {
          requiredChecks: ["lint", "test"],
          maxFilesChanged: 20,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
      {
        name: "repo-b",
        directory: "/abs/repo-b",
        linearProject: undefined,
        linearTeam: "team-b",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: ["**"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 200,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
    defaultRepo: "repo-a",
  };
}

describe("RepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("indexes repos by name, linearProject, and linearTeam", () => {
    const config = validConfig();
    const registry = new RepoRegistry("/root", config, logger);

    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
    expect(registry.getRepoByName("repo-b")?.name).toBe("repo-b");
    expect(registry.getRepoByName("nonexistent")).toBeUndefined();
    expect(registry.getRepoByLinearProject("Project A")?.name).toBe("repo-a");
    expect(registry.getRepoByLinearProject("no-such-project")).toBeUndefined();
    expect(registry.listRepos()).toHaveLength(2);
  });

  it("uses defaultRepo as the default entry", () => {
    const config = validConfig();
    const registry = new RepoRegistry("/root", config, logger);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
  });

  it("throws if defaultRepo does not reference a configured repo", () => {
    const config = { ...validConfig(), defaultRepo: "does-not-exist" };
    expect(() => new RepoRegistry("/root", config, logger)).toThrow(
      /Default repo "does-not-exist" not found in registry/,
    );
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const registry = new RepoRegistry("/root", validConfig(), logger);
      const entry = registry.resolveForIssue("Project A", "team-b");
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to team-based routing when project is unset", () => {
      const registry = new RepoRegistry("/root", validConfig(), logger);
      const entry = registry.resolveForIssue(undefined, "team-b");
      expect(entry.name).toBe("repo-b");
    });

    it("throws when a project is given but unmatched and no team is given", () => {
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.resolveForIssue("Unknown Project", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown Project"/,
      );
    });

    it("falls back to team routing when project is unmatched but a team is given", () => {
      const registry = new RepoRegistry("/root", validConfig(), logger);
      const entry = registry.resolveForIssue("Unknown Project", "team-b");
      expect(entry.name).toBe("repo-b");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/root", validConfig(), logger);
      const entry = registry.resolveForIssue();
      expect(entry.name).toBe("repo-a");
    });

    it("falls back to the default repo when team is given but unmatched and no project", () => {
      const registry = new RepoRegistry("/root", validConfig(), logger);
      const entry = registry.resolveForIssue(undefined, "unknown-team");
      expect(entry.name).toBe("repo-a");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against reposRootPath", () => {
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const entry = registry.getRepoByName("repo-a")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/root/workspace/repo-a");
    });

    it("returns an absolute directory as-is (resolved)", () => {
      const registry = new RepoRegistry("/root/workspace", validConfig(), logger);
      const entry = registry.getRepoByName("repo-b")!;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/repo-b");
    });
  });

  describe("validateWorkingDirectory", () => {
    beforeEach(() => {
      mockedExistsSync.mockReset();
      mockedStatSync.mockReset();
    });

    it("throws when the working directory does not exist", () => {
      mockedExistsSync.mockReturnValue(false);
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/missing")).toThrow(
        /Working directory does not exist: \/root\/missing/,
      );
    });

    it("throws when .git is missing", () => {
      mockedExistsSync.mockImplementation((p: string) => p === "/root/repo-a");
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("throws when .git exists but is neither a file nor a directory", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedStatSync.mockImplementation((p: string) => {
        if (p === "/root/repo-a/.git") {
          return { isDirectory: () => false, isFile: () => false } as unknown as ReturnType<
            typeof statSync
          >;
        }
        return { isDirectory: () => true, isFile: () => false } as unknown as ReturnType<
          typeof statSync
        >;
      });
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory path itself is not a directory", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedStatSync.mockImplementation((p: string) => {
        if (p === "/root/repo-a/.git") {
          return { isDirectory: () => true, isFile: () => false } as unknown as ReturnType<
            typeof statSync
          >;
        }
        return { isDirectory: () => false, isFile: () => false } as unknown as ReturnType<
          typeof statSync
        >;
      });
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).toThrow(
        /Working directory path is not a directory: \/root\/repo-a/,
      );
    });

    it("passes validation for a well-formed clone (directory .git)", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as unknown as ReturnType<typeof statSync>);
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).not.toThrow();
    });

    it("passes validation for a worktree (.git is a file)", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedStatSync.mockImplementation((p: string) => {
        if (p === "/root/repo-a/.git") {
          return { isDirectory: () => false, isFile: () => true } as unknown as ReturnType<
            typeof statSync
          >;
        }
        return { isDirectory: () => true, isFile: () => false } as unknown as ReturnType<
          typeof statSync
        >;
      });
      const registry = new RepoRegistry("/root", validConfig(), logger);
      expect(() => registry.validateWorkingDirectory("/root/repo-a")).not.toThrow();
    });
  });
});

describe("loadRepoRegistry", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    mockedReadFileSync.mockReset();
    mockedExistsSync.mockReset();
    mockedStatSync.mockReset();
  });

  it("loads a valid config from the configured path", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(validConfig()));

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger);

    expect(registry).toBeInstanceOf(RepoRegistry);
    expect(registry.listRepos()).toHaveLength(2);
    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repoCount: 2, defaultRepo: "repo-a" }),
      "Loaded repo registry",
    );
  });

  it("falls back to the .example.json template when the configured file is missing", () => {
    mockedExistsSync.mockImplementation((p: string) => p.endsWith(".example.json"));
    mockedReadFileSync.mockReturnValue(JSON.stringify(validConfig()));

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger);

    expect(registry.listRepos()).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.stringContaining("repos.config.json"),
        fallback: expect.stringContaining("repos.config.example.json"),
      }),
      expect.stringContaining("falling back to the committed example"),
    );
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("repos.config.example.json"),
      "utf-8",
    );
  });

  it("throws when neither the configured file nor the example fallback exists", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger)).toThrow(
      /Repo config not found at .*repos\.config\.json and no example fallback at .*repos\.config\.example\.json/,
    );
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  it("throws (propagates JSON.parse's SyntaxError) on malformed JSON", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("{ not valid json ,,, ");

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger)).toThrow(
      SyntaxError,
    );
  });

  it("throws a ZodError when the parsed config fails schema validation (missing required field)", () => {
    mockedExistsSync.mockReturnValue(true);
    const malformed = {
      repos: [
        {
          // missing required "name"
          directory: "repo-a",
          allowedPaths: [],
          protectedPaths: [],
          constraints: {
            requiredChecks: [],
            maxFilesChanged: 1,
            maxDiffLines: 1,
            forbiddenPatterns: [],
            mustNotTouch: [],
          },
        },
      ],
      defaultRepo: "repo-a",
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(malformed));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger)).toThrow(
      ZodError,
    );
  });

  it("throws a ZodError when a numeric constraint is out of range (zero/non-positive)", () => {
    mockedExistsSync.mockReturnValue(true);
    const config = validConfig();
    config.repos[0].constraints.maxFilesChanged = 0;
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger)).toThrow(
      ZodError,
    );
  });

  it("throws a ZodError when repos is an empty array", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ repos: [], defaultRepo: "repo-a" }));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger)).toThrow(
      ZodError,
    );
  });

  it("throws when defaultRepo does not match any loaded repo", () => {
    mockedExistsSync.mockReturnValue(true);
    const config = { ...validConfig(), defaultRepo: "ghost-repo" };
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger)).toThrow(
      /Default repo "ghost-repo" not found in registry/,
    );
  });

  it("defaults defaultBranch to 'main' when omitted from a repo entry", () => {
    mockedExistsSync.mockReturnValue(true);
    const config = validConfig();
    // @ts-expect-error -- intentionally omit defaultBranch to exercise the zod default
    delete config.repos[0].defaultBranch;
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/workspace", logger);
    expect(registry.getRepoByName("repo-a")?.defaultBranch).toBe("main");
  });
});
