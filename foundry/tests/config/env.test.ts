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

  it("collapses repeated whitespace and trims the result", () => {
    expect(parseBaseArgs("  --flag   value  ")).toEqual(["--flag", "value"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("env validation failure", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    vi.resetModules();
  });

  it("logs the validation error and exits the process when the environment is invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
