import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a whitespace-separated argument string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and ignores leading/trailing space", () => {
    expect(parseBaseArgs("  exec   -  ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("env module load failure", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("logs the validation errors and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
