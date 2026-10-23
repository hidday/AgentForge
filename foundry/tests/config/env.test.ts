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

  it("collapses runs of whitespace (spaces, tabs, newlines) into single separators", () => {
    expect(parseBaseArgs("--print   --output-format\tjson\n--force")).toEqual([
      "--print",
      "--output-format",
      "json",
      "--force",
    ]);
  });

  it("ignores leading and trailing whitespace", () => {
    expect(parseBaseArgs("  --print  ")).toEqual(["--print"]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("env module load-time validation", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs a formatted error and exits the process when required env vars fail validation", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitError = new Error("process.exit called");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw exitError;
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow(exitError);

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    // Second console.error call is the formatted zod error tree.
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("loads successfully and applies defaults when required env vars are valid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.LOG_LEVEL).toBe("info");
    // SYNC_ON_STARTUP defaults to the string "false", transformed to boolean false.
    expect(env.SYNC_ON_STARTUP).toBe(false);
  });

  it("coerces SYNC_ON_STARTUP truthy string variants to boolean true", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "1";

    const { env } = await import("../../src/config/env.js");

    expect(env.SYNC_ON_STARTUP).toBe(true);
    delete process.env.SYNC_ON_STARTUP;
  });
});
