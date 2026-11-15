import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

import { existsSync, readFileSync, statSync } from "node:fs";
import { RepoRegistry, loadRepoRegistry, type ReposConfig } from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const baseConstraints = {
  requiredChecks: ["ci"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

function buildConfig(overrides: Partial<ReposConfig> = {}): ReposConfig {
  return {
    repos: [
      {
        name: "alpha",
        directory: "alpha",
        linearProject: "Alpha Project",
        linearTeam: "ALPHA",
        defaultBranch: "main",
        allowedPaths: [],
        protectedPaths: [],
        constraints: baseConstraints,
      },
      {
        name: "beta",
        directory: "/abs/beta",
        defaultBranch: "main",
        allowedPaths: [],
        protectedPaths: [],
        constraints: baseConstraints,
      },
    ],
    defaultRepo: "beta",
    ...overrides,
  };
}

describe("RepoRegistry", () => {
  it("throws if the default repo isn't present in the config", () => {
    const logger = makeLogger();
    expect(() => new RepoRegistry("/root", buildConfig({ defaultRepo: "missing" }), logger)).toThrow(
      /Default repo "missing" not found/,
    );
  });

  it("looks up repos by name and lists them all", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    expect(registry.getRepoByName("alpha")?.name).toBe("alpha");
    expect(registry.getRepoByName("nope")).toBeUndefined();
    expect(registry.getDefaultRepo().name).toBe("beta");
    expect(registry.listRepos().map((r) => r.name)).toEqual(["alpha", "beta"]);
  });

  it("resolves by exact Linear project match", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    expect(registry.getRepoByLinearProject("Alpha Project")?.name).toBe("alpha");
    expect(registry.resolveForIssue("Alpha Project").name).toBe("alpha");
  });

  it("falls back to team match when no project is given", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    expect(registry.resolveForIssue(undefined, "ALPHA").name).toBe("alpha");
  });

  it("throws when a project is given, unmatched, and there is no team to fall back on", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    expect(() => registry.resolveForIssue("Unknown Project")).toThrow(
      /No repo mapped to Linear project "Unknown Project"/,
    );
  });

  it("falls back to the default repo when both project and team are given but unmatched", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    expect(registry.resolveForIssue("Unknown Project", "UNKNOWN_TEAM").name).toBe("beta");
  });

  it("falls back to the default repo when neither project nor team is given", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    expect(registry.resolveForIssue().name).toBe("beta");
  });

  it("resolves relative directories against the repos root, and leaves absolute ones alone", () => {
    const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
    const alpha = registry.getRepoByName("alpha")!;
    const beta = registry.getRepoByName("beta")!;
    expect(registry.resolveWorkingDirectory(alpha)).toBe(resolve("/root/alpha"));
    expect(registry.resolveWorkingDirectory(beta)).toBe(resolve("/abs/beta"));
  });

  describe("validateWorkingDirectory", () => {
    it("throws if the directory does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory("/root/alpha")).toThrow(/does not exist/);
    });

    it("throws if .git is missing", () => {
      vi.mocked(existsSync).mockImplementation((p) => !String(p).endsWith(".git"));
      const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory("/root/alpha")).toThrow(
        /not a git repository/,
      );
    });

    it("accepts a .git directory (normal clone)", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as unknown as ReturnType<typeof statSync>);
      const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory("/root/alpha")).not.toThrow();
    });

    it("accepts a .git file (worktree)", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation(
        (p) =>
          ({
            isDirectory: () => !String(p).endsWith(".git"),
            isFile: () => String(p).endsWith(".git"),
          }) as unknown as ReturnType<typeof statSync>,
      );
      const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory("/root/alpha")).not.toThrow();
    });

    it("throws if the .git entry is neither a file nor a directory", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation(
        (p) =>
          ({
            isDirectory: () => !String(p).endsWith(".git"),
            isFile: () => false,
          }) as unknown as ReturnType<typeof statSync>,
      );
      const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory("/root/alpha")).toThrow(
        /invalid \.git entry/,
      );
    });

    it("throws if the working directory path itself is not a directory", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation(
        (p) =>
          ({
            isDirectory: () => String(p).endsWith(".git"),
            isFile: () => false,
          }) as unknown as ReturnType<typeof statSync>,
      );
      const registry = new RepoRegistry("/root", buildConfig(), makeLogger());
      expect(() => registry.validateWorkingDirectory("/root/alpha")).toThrow(
        /is not a directory/,
      );
    });
  });
});

describe("loadRepoRegistry", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(statSync).mockReset();
  });

  it("loads and parses a valid config file", () => {
    const logger = makeLogger();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(buildConfig()) as unknown as Buffer);

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/root", logger);

    expect(registry.getDefaultRepo().name).toBe("beta");
    expect(logger.info).toHaveBeenCalled();
  });

  it("falls back to the example config and warns when the primary file is missing", () => {
    const logger = makeLogger();
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith(".example.json"));
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(buildConfig()) as unknown as Buffer);

    const registry = loadRepoRegistry("/cfg/repos.config.json", "/root", logger);

    expect(registry.getDefaultRepo().name).toBe("beta");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("throws when neither the config nor its example exist", () => {
    const logger = makeLogger();
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/root", logger)).toThrow(
      /Repo config not found/,
    );
  });

  it("throws when the file content fails schema validation", () => {
    const logger = makeLogger();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ repos: [], defaultRepo: "x" }) as unknown as Buffer,
    );

    expect(() => loadRepoRegistry("/cfg/repos.config.json", "/root", logger)).toThrow();
  });
});
