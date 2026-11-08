import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Lets individual tests make statSync() lie about a specific path, to exercise
// filesystem states that cannot be created through the real filesystem in CI
// (e.g. a `.git` entry that is neither a file nor a directory, such as a
// socket or device node — or, respectively, a path whose stat briefly
// disagrees with the directory check even though its `.git` child exists).
// All other paths fall through to the real implementation.
const statOverrides = new Map<string, Partial<Stats>>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: (path: Parameters<typeof actual.statSync>[0], ...rest: unknown[]) => {
      const override = statOverrides.get(String(path));
      if (override) return override as Stats;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.statSync as any)(path, ...rest);
    },
  };
});

import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "widgets",
        directory: "widgets",
        linearProject: "Platform",
        linearTeam: undefined,
        assigneeMe: undefined,
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
      {
        name: "gadgets",
        directory: "/abs/gadgets",
        linearTeam: "GAD",
        assigneeMe: true,
        defaultBranch: "main",
        allowedPaths: [],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    ],
    defaultRepo: "widgets",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws when the configured defaultRepo does not exist among the repos", () => {
    expect(
      () => new RepoRegistry("/repos", makeConfig({ defaultRepo: "missing" }), makeLogger() as never),
    ).toThrow(/Default repo "missing" not found/);
  });

  it("getRepoByName returns the matching entry or undefined", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByName("widgets")?.name).toBe("widgets");
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry or undefined", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.getRepoByLinearProject("Platform")?.name).toBe("widgets");
    expect(registry.getRepoByLinearProject("NoProject")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default entry", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.getDefaultRepo().name).toBe("widgets");
  });

  it("listRepos returns every configured entry", () => {
    const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
    expect(registry.listRepos().map((r) => r.name)).toEqual(["widgets", "gadgets"]);
  });

  describe("resolveForIssue", () => {
    it("resolves by exact Linear project match first", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue("Platform", undefined).name).toBe("widgets");
    });

    it("falls back to team-based routing when project is absent", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue(undefined, "GAD").name).toBe("gadgets");
    });

    it("prefers project match over team when both are provided and project matches", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue("Platform", "GAD").name).toBe("widgets");
    });

    it("throws when a project is given but unmatched and there is no team to fall back on", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.resolveForIssue("Unknown", undefined)).toThrow(
        /No repo mapped to Linear project "Unknown"/,
      );
    });

    it("falls back to team routing when the project is unmatched but a team is also given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue("Unknown", "GAD").name).toBe("gadgets");
    });

    it("falls back to the default repo when neither project nor team is given", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue(undefined, undefined).name).toBe("widgets");
    });

    it("falls back to the default repo when the team is given but unmatched", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(registry.resolveForIssue(undefined, "UNKNOWN-TEAM").name).toBe("widgets");
    });
  });

  describe("resolveWorkingDirectory", () => {
    it("resolves a relative directory against the repos root path", () => {
      const registry = new RepoRegistry("/repos-root", makeConfig(), makeLogger() as never);
      const entry = registry.getRepoByName("widgets");
      expect(entry).toBeDefined();
      if (!entry) return;
      expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "widgets"));
    });

    it("returns an absolute directory unchanged (resolved)", () => {
      const registry = new RepoRegistry("/repos-root", makeConfig(), makeLogger() as never);
      const entry = registry.getRepoByName("gadgets");
      expect(entry).toBeDefined();
      if (!entry) return;
      expect(registry.resolveWorkingDirectory(entry)).toBe("/abs/gadgets");
    });
  });

  describe("validateWorkingDirectory", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
      statOverrides.clear();
    });

    it("throws when the working directory does not exist", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(join(tmpDir, "missing"))).toThrow(
        /Working directory does not exist/,
      );
    });

    it("throws when the directory exists but has no .git entry", () => {
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /Working directory is not a git repository/,
      );
    });

    it("accepts a directory whose .git entry is itself a directory (normal clone)", () => {
      mkdirSync(join(tmpDir, ".git"));
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
    });

    it("accepts a directory whose .git entry is a file (git worktree)", () => {
      writeFileSync(join(tmpDir, ".git"), "gitdir: /some/other/path\n");
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(tmpDir)).not.toThrow();
    });

    it("throws when the working directory path is actually a file", () => {
      const filePath = join(tmpDir, "not-a-dir");
      writeFileSync(filePath, "content");
      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      // No .git under a file path, so this hits the "not a git repository" branch first.
      expect(() => registry.validateWorkingDirectory(filePath)).toThrow();
    });

    it("throws when the .git entry exists but is neither a file nor a directory (e.g. a socket or device node)", () => {
      mkdirSync(join(tmpDir, ".git"));
      const gitPath = join(tmpDir, ".git");
      statOverrides.set(gitPath, { isDirectory: () => false, isFile: () => false });

      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /Working directory has invalid \.git entry/,
      );
    });

    it("throws when the working directory's own stat says it is not a directory, despite a valid .git entry", () => {
      mkdirSync(join(tmpDir, ".git"));
      statOverrides.set(tmpDir, { isDirectory: () => false });

      const registry = new RepoRegistry("/repos", makeConfig(), makeLogger() as never);
      expect(() => registry.validateWorkingDirectory(tmpDir)).toThrow(
        /Working directory path is not a directory/,
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

  it("loads and parses a valid repos.config.json", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("widgets");
    expect(logger.info).toHaveBeenCalled();
  });

  it("falls back to the *.example.json file when the configured path is missing", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(makeConfig()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("widgets");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("throws when neither the configured path nor an example fallback exists", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, tmpDir, logger as never)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the JSON fails schema validation", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [], defaultRepo: "widgets" }));
    const logger = makeLogger();

    expect(() => loadRepoRegistry(configPath, tmpDir, logger as never)).toThrow();
  });
});
