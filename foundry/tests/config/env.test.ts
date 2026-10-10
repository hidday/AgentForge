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

  it("collapses multiple consecutive spaces", () => {
    expect(parseBaseArgs("--print   --force")).toEqual(["--print", "--force"]);
  });

  it("drops leading and trailing whitespace", () => {
    expect(parseBaseArgs("  --print --force  ")).toEqual(["--print", "--force"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("loadEnv failure path", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("logs the validation error and calls process.exit(1) when the schema fails to parse", async () => {
    // DATABASE_URL must be a valid url per the schema; corrupting it fails safeParse.
    process.env = { ...originalEnv, DATABASE_URL: "not-a-valid-url" };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("loads successfully (no process.exit) when the environment is valid", async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const mod = await import("../../src/config/env.js");

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mod.env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");

    exitSpy.mockRestore();
  });
});
