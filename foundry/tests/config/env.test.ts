import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe("parseBaseArgs", () => {
  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it("splits on whitespace and filters empty tokens", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print   --output-format  json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for an empty string", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

describe("env module: successful parse", () => {
  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it("parses valid environment variables into the typed env singleton", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.PORT = "4000";
    process.env.LOG_LEVEL = "debug";
    const { env } = await import("../../src/config/env.js");
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
  });

  it("applies defaults for optional fields when unset", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    delete process.env.AGENT_RUNTIME_MODE;
    delete process.env.CLAUDE_CODE_COMMAND;
    const { env } = await import("../../src/config/env.js");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.CLAUDE_CODE_COMMAND).toBe("claude");
  });

  it("transforms SYNC_ON_STARTUP truthy string variants to boolean true", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "1";
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(true);
  });

  it("transforms SYNC_ON_STARTUP falsy string variants to boolean false", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "0";
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(false);
  });

  it("rejects an AGENT_RUNTIME_MODE outside the mock|real enum by falling back to failure path", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.AGENT_RUNTIME_MODE = "bogus-mode";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("env module: invalid configuration", () => {
  afterEach(() => {
    resetEnv();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs the validation error and calls process.exit(1) when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs the validation error and calls process.exit(1) when DATABASE_URL is not a valid URL", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
