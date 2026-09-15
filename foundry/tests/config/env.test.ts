import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a simple space-separated args string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("filters out empty strings caused by multiple consecutive spaces", () => {
    expect(parseBaseArgs("--print    --output-format   json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("handles tabs and mixed whitespace", () => {
    expect(parseBaseArgs("--print\t--output-format\t\tjson")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for a single arg", () => {
    expect(parseBaseArgs("exec")).toEqual(["exec"]);
  });
});

describe("loadEnv failure branch", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs an error and exits the process when validation fails", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
