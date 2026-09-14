import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe("parseBaseArgs", () => {
  it("splits a base-args string on whitespace into individual tokens", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and filters out empty tokens", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print    --force   --trust")).toEqual([
      "--print",
      "--force",
      "--trust",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("loadEnv() failure path", () => {
  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    // Second console.error call carries the zod-formatted error tree.
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("loads successfully and applies defaults when DATABASE_URL is a valid URL", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
  });
});
