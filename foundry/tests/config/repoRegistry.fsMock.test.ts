import { describe, it, expect, vi, beforeEach } from "vitest";

const { existsSyncMock, statSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(actual as any).default,
      existsSync: existsSyncMock,
      statSync: statSyncMock,
    },
    existsSync: existsSyncMock,
    statSync: statSyncMock,
  };
});

// These two branches (a .git entry that is neither a directory nor a regular
// file, and a workingDirectory that passes the .git checks but isn't itself
// a directory) cannot be produced with real filesystem fixtures -- a path
// can't have children unless it's a directory, and any special file (FIFO,
// socket) that IS neither dir nor file also can't contain a ".git" entry.
// They read as deliberate defensive guards, so fs is mocked here to exercise
// them directly.
import { RepoRegistry, type ReposConfig, type RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme-backend",
    directory: "acme-backend",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeConfig(repos: RepoEntry[]): ReposConfig {
  return { repos, defaultRepo: repos[0]?.name ?? "" };
}

function buildRegistry() {
  const logger = makeLogger();
  const entry = makeRepoEntry();
  return new RepoRegistry("/repos", makeConfig([entry]), logger);
}

describe("RepoRegistry.validateWorkingDirectory defensive branches (mocked fs)", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    statSyncMock.mockReset();
  });

  it("throws when the .git entry exists but is neither a directory nor a regular file", () => {
    const registry = buildRegistry();
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ isDirectory: () => false, isFile: () => false });

    expect(() => registry.validateWorkingDirectory("/fake/repo")).toThrow(
      /Working directory has invalid \.git entry/,
    );
  });

  it("throws when the working directory path itself is not a directory", () => {
    const registry = buildRegistry();
    existsSyncMock.mockReturnValue(true);
    statSyncMock
      // .git stat: looks like a normal clone directory
      .mockReturnValueOnce({ isDirectory: () => true, isFile: () => false })
      // final workingDirectory stat: not a directory
      .mockReturnValueOnce({ isDirectory: () => false });

    expect(() => registry.validateWorkingDirectory("/fake/repo")).toThrow(
      "Working directory path is not a directory: /fake/repo.",
    );
  });
});
