import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = [
  "PORT",
  "DATABASE_URL",
  "AGENT_RUNTIME_MODE",
  "CLAUDE_CODE_COMMAND",
  "CLAUDE_CODE_ARGS_BASE",
  "CLAUDE_CODE_MODEL",
  "CLAUDE_CODE_MODEL_RESEARCH",
  "CODEX_COMMAND",
  "CODEX_ARGS_BASE",
  "CODEX_MODEL",
  "CURSOR_COMMAND",
  "CURSOR_ARGS_BASE",
  "CURSOR_MODEL",
  "AGENT_TIMEOUT_MS",
  "EXECUTOR_TIMEOUT_MS",
  "CHAT_TIMEOUT_MS",
  "REPOS_ROOT_PATH",
  "REPOS_CONFIG_PATH",
  "LOG_LEVEL",
  "LINEAR_API_KEY",
  "GITHUB_TOKEN",
  "SYNC_ON_STARTUP",
  "NOTIFY_EMAIL_TO",
  "NOTIFY_EMAIL_FROM",
  "NOTIFY_SLACK_WEBHOOK_URL",
  "RESEND_API_KEY",
  "FOUNDRY_UI_BASE_URL",
  "NOTIFY_DEBOUNCE_HOURS",
  "MAX_SKILLS_PER_REPO",
  "MAX_SKILLS_INJECTED",
  "NOVELTY_SIMILARITY_THRESHOLD",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  vi.resetModules();
  vi.restoreAllMocks();
});

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe("parseBaseArgs", () => {
  it("splits a simple space-separated args string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and trims leading/trailing whitespace", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  --foo   --bar\t--baz  ")).toEqual(["--foo", "--bar", "--baz"]);
  });

  it("returns an empty array for an empty or whitespace-only string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("env module - successful load", () => {
  it("applies defaults and coerces values when only required vars are set", async () => {
    vi.resetModules();
    clearEnv();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const { env } = await import("../../src/config/env.js");

    expect(env.PORT).toBe(3100);
    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.CLAUDE_CODE_COMMAND).toBe("claude");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.SYNC_ON_STARTUP).toBe(false);
    expect(env.NOTIFY_DEBOUNCE_HOURS).toBe(6);
    expect(env.MAX_SKILLS_PER_REPO).toBe(200);
    expect(env.MAX_SKILLS_INJECTED).toBe(3);
    expect(env.NOVELTY_SIMILARITY_THRESHOLD).toBe(0.5);
  });

  it("coerces numeric string overrides to numbers", async () => {
    vi.resetModules();
    clearEnv();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.PORT = "8080";
    process.env.AGENT_TIMEOUT_MS = "5000";

    const { env } = await import("../../src/config/env.js");

    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe("number");
    expect(env.AGENT_TIMEOUT_MS).toBe(5000);
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("transforms SYNC_ON_STARTUP=%s to boolean %s", async (raw, expected) => {
    vi.resetModules();
    clearEnv();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = raw;

    const { env } = await import("../../src/config/env.js");

    expect(env.SYNC_ON_STARTUP).toBe(expected);
  });

  it("leaves optional vars undefined when not provided", async () => {
    vi.resetModules();
    clearEnv();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const { env } = await import("../../src/config/env.js");

    expect(env.LINEAR_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NOTIFY_EMAIL_TO).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
  });
});

describe("env module - invalid configuration", () => {
  it("logs the validation error and exits the process when DATABASE_URL is missing", async () => {
    vi.resetModules();
    clearEnv();
    // DATABASE_URL intentionally left unset - required, no default.

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => {
        throw new Error("process.exit called");
      }) as unknown as (code?: number) => never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs the validation error and exits the process when DATABASE_URL is not a valid URL", async () => {
    vi.resetModules();
    clearEnv();
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => {
        throw new Error("process.exit called");
      }) as unknown as (code?: number) => never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits the process when an enum field holds an unrecognized value", async () => {
    vi.resetModules();
    clearEnv();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.AGENT_RUNTIME_MODE = "not-a-real-mode";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => {
        throw new Error("process.exit called");
      }) as unknown as (code?: number) => never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
