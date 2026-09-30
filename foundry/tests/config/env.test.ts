import { describe, it, expect, vi, afterEach } from "vitest";

describe("env", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("parses a valid environment and applies documented defaults", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;
    const { env } = await import("../../src/config/env.js");
    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.PORT).toBe(3100);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
  });

  it("coerces SYNC_ON_STARTUP truthy string variants to a boolean true", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "1";
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(true);
  });

  it("coerces SYNC_ON_STARTUP 'false' to a boolean false", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "false";
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(false);
  });

  it("logs the error details and exits with code 1 when required env vars are invalid (gap coverage)", async () => {
    vi.resetModules();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DATABASE_URL = "this-is-not-a-valid-url";

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("triggers the invalid-config branch when DATABASE_URL is missing entirely", async () => {
    vi.resetModules();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.DATABASE_URL;

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("parseBaseArgs splits a whitespace-separated string into non-empty tokens", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print   --output-format  json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("parseBaseArgs returns an empty array for an empty or whitespace-only string", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});
