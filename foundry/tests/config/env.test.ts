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

  it("collapses multiple consecutive spaces instead of producing empty tokens", () => {
    expect(parseBaseArgs("exec   -")).toEqual(["exec", "-"]);
  });

  it("trims leading and trailing whitespace", () => {
    expect(parseBaseArgs("  exec -  ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for a single argument", () => {
    expect(parseBaseArgs("solo")).toEqual(["solo"]);
  });

  it("splits on tabs and newlines as well as spaces", () => {
    expect(parseBaseArgs("a\tb\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("loadEnv (module-load-time validation)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("parses successfully and applies defaults when required env vars are present", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    delete process.env.AGENT_RUNTIME_MODE;

    vi.resetModules();
    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("transforms SYNC_ON_STARTUP string values into a boolean", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "true";

    vi.resetModules();
    const { env } = await import("../../src/config/env.js");

    expect(env.SYNC_ON_STARTUP).toBe(true);
  });

  it("logs the validation error and exits with code 1 when required env vars are invalid", async () => {
    // DATABASE_URL is required and must be a URL -- omit it entirely to
    // trigger the invalid-config branch.
    delete process.env.DATABASE_URL;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("reports a formatted zod error for the specific invalid field", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    await import("../../src/config/env.js");

    const formattedCall = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null,
    );
    expect(formattedCall).toBeDefined();
    expect(JSON.stringify(formattedCall![0])).toContain("DATABASE_URL");
  });
});
