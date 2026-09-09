import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a simple space-separated arg string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace between args", () => {
    expect(parseBaseArgs("--print    --force")).toEqual(["--print", "--force"]);
  });

  it("filters out empty tokens produced by leading/trailing whitespace", () => {
    expect(parseBaseArgs("  --print --force  ")).toEqual(["--print", "--force"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for a single arg with no spaces", () => {
    expect(parseBaseArgs("exec")).toEqual(["exec"]);
  });
});

describe("env module: invalid configuration handling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs the formatted error and calls process.exit(1) when required env vars fail validation", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "not-a-valid-url");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
