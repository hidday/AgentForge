import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("parseBaseArgs", () => {
  it("splits a whitespace-separated args string into tokens", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and trims leading/trailing space", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  --a   --b  ")).toEqual(["--a", "--b"]);
  });

  it("returns an empty array for an empty string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns a single-element array for a single flag", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print")).toEqual(["--print"]);
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
    vi.restoreAllMocks();
  });

  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    // DATABASE_URL is required and must be a URL; unsetting it fails EnvSchema.safeParse.
    delete process.env.DATABASE_URL;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi
      .spyOn(process, "exit")
      // @ts-expect-error -- stub process.exit's return type (never) for the test double
      .mockImplementation(() => undefined);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
