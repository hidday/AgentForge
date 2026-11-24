import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a simple space-separated args string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and trims the ends", () => {
    expect(parseBaseArgs("  exec   -   ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("env module error handling", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("exits the process and logs when required env vars are invalid", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("loads successfully and applies defaults when the env is valid", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    vi.resetModules();

    const { env } = await import("../../src/config/env.js");

    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
  });

  it("coerces the SYNC_ON_STARTUP string flag to a boolean", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "1";
    vi.resetModules();

    const { env } = await import("../../src/config/env.js");

    expect(env.SYNC_ON_STARTUP).toBe(true);
  });
});
