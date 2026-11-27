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

  it("collapses repeated whitespace and trims leading/trailing whitespace", () => {
    expect(parseBaseArgs("  exec   -   ")).toEqual(["exec", "-"]);
  });

  it("handles tabs and newlines as whitespace separators", () => {
    expect(parseBaseArgs("a\tb\nc")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty or all-whitespace string", () => {
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("loadEnv (module-level env validation)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("parses successfully and applies documented defaults when optional vars are unset", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    };
    delete process.env.PORT;
    delete process.env.AGENT_RUNTIME_MODE;
    delete process.env.LOG_LEVEL;

    const mod = await import("../../src/config/env.js");

    expect(mod.env.PORT).toBe(3100);
    expect(mod.env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(mod.env.LOG_LEVEL).toBe("info");
    expect(mod.env.CLAUDE_CODE_MODEL).toBe("claude-fable-5");
    expect(mod.env.SYNC_ON_STARTUP).toBe(false);
  });

  it("coerces truthy string forms of SYNC_ON_STARTUP to a boolean", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SYNC_ON_STARTUP: "1",
    };

    const mod = await import("../../src/config/env.js");
    expect(mod.env.SYNC_ON_STARTUP).toBe(true);
  });

  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: "not-a-valid-url",
    };

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit(1) called");
    }) as (code?: number) => never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1) called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("fails validation when DATABASE_URL is missing entirely", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;

    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit(1) called");
    }) as (code?: number) => never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1) called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
