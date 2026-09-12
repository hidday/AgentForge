import { describe, it, expect, vi, afterEach } from "vitest";

describe("parseBaseArgs", () => {
  it("splits on whitespace and filters out empty tokens", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print   --output-format  json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("trims leading/trailing whitespace around a single token", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  --print  ")).toEqual(["--print"]);
  });
});

describe("loadEnv failure path", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs the validation errors and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env.DATABASE_URL = "not-a-valid-url";

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
