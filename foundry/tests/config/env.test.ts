import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a simple space-separated argument string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace between arguments", () => {
    expect(parseBaseArgs("exec   -   foo")).toEqual(["exec", "-", "foo"]);
  });

  it("ignores leading and trailing whitespace", () => {
    expect(parseBaseArgs("  exec -  ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for a single token", () => {
    expect(parseBaseArgs("claude")).toEqual(["claude"]);
  });
});

describe("env (module-level parsed configuration)", () => {
  it("applies documented defaults for unset optional variables", async () => {
    const { env } = await import("../../src/config/env.js");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.CLAUDE_CODE_COMMAND).toBe("claude");
    expect(env.CLAUDE_CODE_ARGS_BASE).toBe("--print --output-format json");
    expect(env.CODEX_COMMAND).toBe("codex");
    expect(env.CURSOR_COMMAND).toBe("agent");
    expect(env.AGENT_TIMEOUT_MS).toBe(120_000);
    expect(env.EXECUTOR_TIMEOUT_MS).toBe(3_600_000);
    expect(env.REPOS_ROOT_PATH).toBe("./workspace");
    expect(env.REPOS_CONFIG_PATH).toBe("./repos.config.json");
    expect(env.NOTIFY_EMAIL_FROM).toBe("AgentForge <onboarding@resend.dev>");
    expect(env.FOUNDRY_UI_BASE_URL).toBe("http://localhost:5173");
    expect(env.NOTIFY_DEBOUNCE_HOURS).toBe(6);
    expect(env.MAX_SKILLS_PER_REPO).toBe(200);
    expect(env.MAX_SKILLS_INJECTED).toBe(3);
    expect(env.NOVELTY_SIMILARITY_THRESHOLD).toBe(0.5);
    // DATABASE_URL has no default; it is required and supplied by the test harness.
    expect(typeof env.DATABASE_URL).toBe("string");
  });
});

describe("env (dynamic re-evaluation)", () => {
  const SNAPSHOT_KEYS = ["DATABASE_URL", "SYNC_ON_STARTUP", "LOG_LEVEL"] as const;
  const originalValues: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of SNAPSHOT_KEYS) {
      originalValues[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SNAPSHOT_KEYS) {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key];
      }
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("transforms SYNC_ON_STARTUP=%s to boolean %s", async (raw, expected) => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = raw;

    const { env } = await import("../../src/config/env.js");

    expect(env.SYNC_ON_STARTUP).toBe(expected);
  });

  it("defaults SYNC_ON_STARTUP to false when unset", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.SYNC_ON_STARTUP;

    const { env } = await import("../../src/config/env.js");

    expect(env.SYNC_ON_STARTUP).toBe(false);
  });

  it("logs the validation errors and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as unknown as typeof process.exit);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    // Second console.error call is the formatted zod error tree for the bad DATABASE_URL.
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("accepts a valid DATABASE_URL and does not touch process.exit", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
