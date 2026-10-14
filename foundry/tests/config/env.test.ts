import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("parseBaseArgs", () => {
  it("splits a simple space-separated args string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and drops empty tokens from leading/trailing spaces", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  exec   -  ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("loadEnv failure path", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("logs the validation errors and exits the process when required env vars are invalid", async () => {
    // DATABASE_URL must be a valid URL; an empty string fails validation.
    process.env.DATABASE_URL = "";

    const exitError = new Error("process.exit called");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow(exitError);

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
