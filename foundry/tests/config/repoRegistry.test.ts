import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as NodeFs from "node:fs";

// node:fs exports are non-configurable, so vi.spyOn cannot override statSync
// directly. Use vi.mock with a hoisted, per-test-controllable override
// instead, falling back to the real implementation for everything else
// (including the other tests in this file, which need real fs behavior).
const statOverride = vi.hoisted(() => ({
  fn: null as ((p: unknown) => NodeFs.Stats | undefined) | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: (p: NodeFs.PathLike, opts?: unknown) => {
      const override = statOverride.fn?.(p);
      if (override !== undefined) return override;
      return (actual.statSync as (p: NodeFs.PathLike, opts?: unknown) => NodeFs.Stats)(p, opts);
    },
  };
});

import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
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
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
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

function makeConfig(repos: RepoEntry[], defaultRepo: string): ReposConfig {
  return { repos, defaultRepo };
}

describe("RepoRegistry constructor", () => {
  it("throws when defaultRepo doesn't match any entry name", () => {
    const config = makeConfig([makeEntry({ name: "repo-a" }), makeEntry({ name: "repo-b" })], "missing-repo");
    expect(() => new RepoRegistry("/repos", config, makeLogger() as never)).toThrow(
      /not found in registry/,
    );
    try {
      new RepoRegistry("/repos", config, makeLogger() as never);
    } catch (err) {
      expect((err as Error).message).toContain("repo-a");
      expect((err as Error).message).toContain("repo-b");
    }
  });

  it("succeeds when defaultRepo matches an entry", () => {
    const config = makeConfig([makeEntry({ name: "repo-a" })], "repo-a");
    expect(() => new RepoRegistry("/repos", config, makeLogger() as never)).not.toThrow();
  });
});

describe("RepoRegistry lookups", () => {
  function buildRegistry() {
    const config = makeConfig(
      [
        makeEntry({ name: "repo-a", linearProject: "proj-a" }),
        makeEntry({ name: "repo-b", linearTeam: "team-b", assigneeMe: true }),
        makeEntry({ name: "repo-default" }),
      ],
      "repo-default",
    );
    return new RepoRegistry("/repos", config, makeLogger() as never);
  }

  it("getRepoByName returns the matching entry", () => {
    const registry = buildRegistry();
    expect(registry.getRepoByName("repo-a")?.name).toBe("repo-a");
  });

  it("getRepoByName returns undefined for an unknown name", () => {
    const registry = buildRegistry();
    expect(registry.getRepoByName("nope")).toBeUndefined();
  });

  it("getRepoByLinearProject returns the matching entry", () => {
    const registry = buildRegistry();
    expect(registry.getRepoByLinearProject("proj-a")?.name).toBe("repo-a");
  });

  it("getRepoByLinearProject returns undefined for an unmatched project", () => {
    const registry = buildRegistry();
    expect(registry.getRepoByLinearProject("proj-nope")).toBeUndefined();
  });

  it("getDefaultRepo returns the configured default", () => {
    const registry = buildRegistry();
    expect(registry.getDefaultRepo().name).toBe("repo-default");
  });

  it("listRepos returns all entries", () => {
    const registry = buildRegistry();
    const names = registry.listRepos().map((r) => r.name);
    expect(names).toEqual(["repo-a", "repo-b", "repo-default"]);
  });
});

describe("RepoRegistry.resolveForIssue", () => {
  function buildRegistry() {
    const config = makeConfig(
      [
        makeEntry({ name: "repo-a", linearProject: "proj-a" }),
        makeEntry({ name: "repo-b", linearTeam: "team-b", assigneeMe: true }),
        makeEntry({ name: "repo-default" }),
      ],
      "repo-default",
    );
    return new RepoRegistry("/repos", config, makeLogger() as never);
  }

  it("resolves via exact project match first", () => {
    const registry = buildRegistry();
    const entry = registry.resolveForIssue("proj-a", "team-b");
    expect(entry.name).toBe("repo-a");
  });

  it("resolves via team match when no project match and project is omitted", () => {
    const registry = buildRegistry();
    const entry = registry.resolveForIssue(undefined, "team-b");
    expect(entry.name).toBe("repo-b");
  });

  it("resolves via team when project is provided but unmatched and team matches (not the throw case)", () => {
    const registry = buildRegistry();
    const entry = registry.resolveForIssue("unknown-project", "team-b");
    expect(entry.name).toBe("repo-b");
  });

  it("throws when project is given but unmatched and no team is provided", () => {
    const registry = buildRegistry();
    expect(() => registry.resolveForIssue("unknown-project", undefined)).toThrow(
      /No repo mapped to Linear project "unknown-project"/,
    );
    try {
      registry.resolveForIssue("unknown-project", undefined);
    } catch (err) {
      expect((err as Error).message).toContain("proj-a");
    }
  });

  it("falls back to default repo when neither project nor team resolve anything", () => {
    const registry = buildRegistry();
    const entry = registry.resolveForIssue(undefined, undefined);
    expect(entry.name).toBe("repo-default");
  });

  it("falls back to default repo when team is given but unmatched (no project)", () => {
    const registry = buildRegistry();
    const entry = registry.resolveForIssue(undefined, "unknown-team");
    expect(entry.name).toBe("repo-default");
  });
});

describe("RepoRegistry.resolveWorkingDirectory", () => {
  function buildRegistry(reposRootPath: string) {
    const config = makeConfig([makeEntry({ name: "repo-a" })], "repo-a");
    return new RepoRegistry(reposRootPath, config, makeLogger() as never);
  }

  it("returns an absolute directory as-is (resolved)", () => {
    const registry = buildRegistry("/repos-root");
    const entry = makeEntry({ name: "repo-a", directory: "/absolute/path/repo-a" });
    expect(registry.resolveWorkingDirectory(entry)).toBe("/absolute/path/repo-a");
  });

  it("joins a relative directory with reposRootPath", () => {
    const registry = buildRegistry("/repos-root");
    const entry = makeEntry({ name: "repo-a", directory: "relative-repo" });
    expect(registry.resolveWorkingDirectory(entry)).toBe(join("/repos-root", "relative-repo"));
  });
});

describe("RepoRegistry.validateWorkingDirectory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "repo-registry-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildRegistry() {
    const config = makeConfig([makeEntry({ name: "repo-a" })], "repo-a");
    return new RepoRegistry(tmpDir, config, makeLogger() as never);
  }

  it("throws when the directory doesn't exist", () => {
    const registry = buildRegistry();
    const missing = join(tmpDir, "does-not-exist");
    expect(() => registry.validateWorkingDirectory(missing)).toThrow(/does not exist/);
  });

  it("throws when the directory exists but has no .git entry", () => {
    const registry = buildRegistry();
    const dir = join(tmpDir, "no-git");
    mkdirSync(dir);
    expect(() => registry.validateWorkingDirectory(dir)).toThrow(/not a git repository/);
  });

  it("passes when .git exists as a directory (normal clone)", () => {
    const registry = buildRegistry();
    const dir = join(tmpDir, "normal-clone");
    mkdirSync(dir);
    mkdirSync(join(dir, ".git"));
    expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
  });

  it("passes when .git exists as a file (worktree-style)", () => {
    const registry = buildRegistry();
    const dir = join(tmpDir, "worktree");
    mkdirSync(dir);
    writeFileSync(join(dir, ".git"), "gitdir: /some/other/path");
    expect(() => registry.validateWorkingDirectory(dir)).not.toThrow();
  });

  it("throws 'not a git repository' when pointed directly at a file (can't have a nested .git)", () => {
    const registry = buildRegistry();
    const filePath = join(tmpDir, "just-a-file");
    writeFileSync(filePath, "content");
    expect(() => registry.validateWorkingDirectory(filePath)).toThrow(/not a git repository/);
  });

  it("throws 'is not a directory' when workingDirectory exists, has a real .git, but its own stat reports non-directory", () => {
    // Reaching this branch requires existsSync(workingDirectory) and
    // existsSync(<workingDirectory>/.git) to both be true while
    // statSync(workingDirectory).isDirectory() is false -- impossible with a
    // real filesystem entry (a non-directory can't have filesystem
    // children), so we build the real .git-containing directory and
    // override only the final statSync(workingDirectory) call via the
    // hoisted node:fs mock.
    const registry = buildRegistry();
    const dir = join(tmpDir, "looks-like-a-dir");
    mkdirSync(dir);
    mkdirSync(join(dir, ".git"));

    statOverride.fn = (p) => {
      if (p === dir) {
        return { isDirectory: () => false, isFile: () => true } as unknown as NodeFs.Stats;
      }
      return undefined;
    };

    try {
      expect(() => registry.validateWorkingDirectory(dir)).toThrow(/is not a directory/);
    } finally {
      statOverride.fn = null;
    }
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

  function validConfigJson() {
    return {
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
  }

  it("loads successfully when configPath exists and is valid JSON", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify(validConfigJson()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]?.[1]).toBe("Loaded repo registry");
  });

  it("falls back to the sibling .example.json when configPath is missing", () => {
    const configPath = join(tmpDir, "repos.config.json");
    const examplePath = join(tmpDir, "repos.config.example.json");
    writeFileSync(examplePath, JSON.stringify(validConfigJson()));
    const logger = makeLogger();

    const registry = loadRepoRegistry(configPath, tmpDir, logger as never);

    expect(registry.getDefaultRepo().name).toBe("repo-a");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnPayload = logger.warn.mock.calls[0]?.[0] as { expected: string; fallback: string };
    expect(warnPayload.expected).toBe(configPath);
    expect(warnPayload.fallback).toBe(examplePath);
  });

  it("throws when neither configPath nor the example fallback exist", () => {
    const configPath = join(tmpDir, "repos.config.json");
    expect(() => loadRepoRegistry(configPath, tmpDir, makeLogger() as never)).toThrow(
      /Repo config not found .* and no example fallback/,
    );
    expect(existsSync(configPath)).toBe(false);
  });

  it("throws (zod error) when the config file's JSON fails schema validation", () => {
    const configPath = join(tmpDir, "repos.config.json");
    writeFileSync(configPath, JSON.stringify({ notRepos: [] }));
    expect(() => loadRepoRegistry(configPath, tmpDir, makeLogger() as never)).toThrow();
  });
});
