import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

describe("config/env parseBaseArgs", () => {
  it("splits a simple space-separated argument string", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and trims leading/trailing whitespace", () => {
    expect(parseBaseArgs("  --print   --force  ")).toEqual(["--print", "--force"]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for a string with no whitespace", () => {
    expect(parseBaseArgs("exec")).toEqual(["exec"]);
  });
});

describe("config/env loadEnv (module-level validation)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("parses a valid environment and applies documented defaults", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    delete process.env.AGENT_RUNTIME_MODE;
    delete process.env.SYNC_ON_STARTUP;
    delete process.env.LOG_LEVEL;

    const { env } = await import("../../src/config/env.js");

    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.SYNC_ON_STARTUP).toBe(false);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
  });

  it('transforms SYNC_ON_STARTUP="true" and "1" to boolean true', async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "true";
    const { env: envTrue } = await import("../../src/config/env.js");
    expect(envTrue.SYNC_ON_STARTUP).toBe(true);

    vi.resetModules();
    process.env.SYNC_ON_STARTUP = "1";
    const { env: envOne } = await import("../../src/config/env.js");
    expect(envOne.SYNC_ON_STARTUP).toBe(true);
  });

  it('transforms SYNC_ON_STARTUP="false" and "0" to boolean false', async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "false";
    const { env: envFalse } = await import("../../src/config/env.js");
    expect(envFalse.SYNC_ON_STARTUP).toBe(false);

    vi.resetModules();
    process.env.SYNC_ON_STARTUP = "0";
    const { env: envZero } = await import("../../src/config/env.js");
    expect(envZero.SYNC_ON_STARTUP).toBe(false);
  });

  it("logs the validation error and exits the process when the environment is invalid", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    // PORT fails z.coerce.number().int().positive() validation.
    process.env.PORT = "not-a-number";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("rejects a DATABASE_URL that is not a valid URL", async () => {
    process.env.DATABASE_URL = "not-a-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
