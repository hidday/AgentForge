import { describe, it, expect, vi, afterEach } from "vitest";
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
    expect(parseBaseArgs("--print   --output-format    json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("trims leading and trailing whitespace", () => {
    expect(parseBaseArgs("  --print --trust  ")).toEqual(["--print", "--trust"]);
  });

  it("handles tabs and newlines as separators", () => {
    expect(parseBaseArgs("--a\t--b\n--c")).toEqual(["--a", "--b", "--c"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("loadEnv (module-level validation)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock("dotenv");
    vi.resetModules();
  });

  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("does not exit the process when the environment is valid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const mod = await import("../../src/config/env.js");

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mod.env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");

    exitSpy.mockRestore();
  });
});
