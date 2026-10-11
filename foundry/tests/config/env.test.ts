import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("env — parseBaseArgs", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("splits a whitespace-separated args string into tokens", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print  --output-format   json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("   ")).toEqual([]);
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("env — loadEnv failure path", () => {
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.exit = originalExit;
    console.error = originalConsoleError;
    vi.resetModules();
  });

  it("logs the validation error and calls process.exit(1) when required env vars are invalid/missing", async () => {
    // DATABASE_URL is required (z.string().url()) and is intentionally omitted
    // / invalid here to force EnvSchema.safeParse to fail.
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
      // Throw to halt module evaluation the same way a real process.exit
      // would halt execution, without actually killing the test runner.
      throw new Error("process.exit called");
    }) as unknown) as (code?: number) => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("loads successfully and applies defaults when required env vars are valid", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    delete process.env.AGENT_RUNTIME_MODE;

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
  });
});
