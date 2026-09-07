import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a space-separated argument string into an array", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses multiple consecutive spaces and trims surrounding whitespace", () => {
    expect(parseBaseArgs("  exec   -  ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns a single-element array for a string with no spaces", () => {
    expect(parseBaseArgs("exec")).toEqual(["exec"]);
  });
});

describe("env module load failure", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    // DATABASE_URL is required and must be a URL -- omit it to fail validation.
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
