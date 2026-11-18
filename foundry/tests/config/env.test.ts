import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

const BASE_VALID_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
};

describe("parseBaseArgs", () => {
  it("splits a simple space-separated argument string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and filters out empty tokens", () => {
    expect(parseBaseArgs("  --print   --force  ")).toEqual(["--print", "--force"]);
  });

  it("treats tabs and newlines as separators too", () => {
    expect(parseBaseArgs("a\tb\nc")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("env (loadEnv)", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadWithEnv(envOverrides: Record<string, string | undefined>) {
    process.env = { ...ORIGINAL_ENV, ...BASE_VALID_ENV, ...envOverrides };
    vi.resetModules();
    return import("../../src/config/env.js");
  }

  it("applies documented defaults when only DATABASE_URL is set", async () => {
    const { env } = await loadWithEnv({
      PORT: undefined,
      AGENT_RUNTIME_MODE: undefined,
      SYNC_ON_STARTUP: undefined,
      LOG_LEVEL: undefined,
    });

    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.SYNC_ON_STARTUP).toBe(false);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CLAUDE_CODE_COMMAND).toBe("claude");
  });

  it("coerces numeric and enum overrides from string env vars", async () => {
    const { env } = await loadWithEnv({
      PORT: "8080",
      AGENT_TIMEOUT_MS: "5000",
      LOG_LEVEL: "debug",
    });

    expect(env.PORT).toBe(8080);
    expect(env.AGENT_TIMEOUT_MS).toBe(5000);
    expect(env.LOG_LEVEL).toBe("debug");
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("transforms SYNC_ON_STARTUP=%s to boolean %s", async (raw, expected) => {
    const { env } = await loadWithEnv({ SYNC_ON_STARTUP: raw });
    expect(env.SYNC_ON_STARTUP).toBe(expected);
  });

  it("logs an error and exits the process when required config is invalid", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
      // Prevent the test runner from actually exiting; loadEnv() continues
      // past this call in the test, same as the real non-test failure path
      // would if exit() didn't terminate the process immediately.
      return undefined as never;
    }) as unknown) as typeof process.exit);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env = { ...ORIGINAL_ENV, DATABASE_URL: "not-a-valid-url" };
    vi.resetModules();
    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("rejects an out-of-range enum value for AGENT_RUNTIME_MODE", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => undefined as never) as unknown) as typeof process.exit);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env = { ...ORIGINAL_ENV, ...BASE_VALID_ENV, AGENT_RUNTIME_MODE: "bogus" };
    vi.resetModules();
    await import("../../src/config/env.js");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
