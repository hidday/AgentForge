import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a whitespace-separated argument string into tokens", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and trims leading/trailing space", () => {
    expect(parseBaseArgs("  exec   -  ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("env module load failure", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs an error and exits the process when required env vars are invalid", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
