import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("parseBaseArgs", () => {
  it("splits a simple space-separated args string", async () => {
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
});

describe("loadEnv (module-load validation)", () => {
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  it("loads successfully and applies defaults when required vars are valid", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.PORT).toBe(3100);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("logs the validation error and exits the process when DATABASE_URL is not a valid URL", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs the validation error and exits the process when DATABASE_URL is missing entirely", async () => {
    delete process.env.DATABASE_URL;

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("transforms SYNC_ON_STARTUP string values into a boolean", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.SYNC_ON_STARTUP = "1";

    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(true);
  });

  it("rejects an out-of-range MAX_SKILLS_INJECTED value", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.MAX_SKILLS_INJECTED = "20";

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
