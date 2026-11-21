import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits on any whitespace run and drops empty tokens", () => {
    expect(parseBaseArgs("  --print\t--output-format   json \n")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });
});

// env.ts validates process.env at import time, so each case stubs env vars
// and imports a fresh copy of the module.
async function freshEnv() {
  vi.resetModules();
  return (await import("../../src/config/env.js")).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("env loading", () => {
  it("coerces numeric and boolean settings from strings", async () => {
    vi.stubEnv("PORT", "4100");
    vi.stubEnv("SYNC_ON_STARTUP", "1");
    vi.stubEnv("NOVELTY_SIMILARITY_THRESHOLD", "0.25");

    const env = await freshEnv();

    expect(env.PORT).toBe(4100);
    expect(env.SYNC_ON_STARTUP).toBe(true);
    expect(env.NOVELTY_SIMILARITY_THRESHOLD).toBe(0.25);
  });

  it("treats SYNC_ON_STARTUP='false' as false", async () => {
    vi.stubEnv("SYNC_ON_STARTUP", "false");
    expect((await freshEnv()).SYNC_ON_STARTUP).toBe(false);
  });

  it("logs the validation errors and exits with code 1 on invalid configuration", async () => {
    vi.stubEnv("DATABASE_URL", "not-a-url");
    vi.stubEnv("MAX_SKILLS_INJECTED", "11");
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as never);

    await expect(freshEnv()).rejects.toThrow("process.exit(1)");

    expect(exit).toHaveBeenCalledWith(1);
    expect(errors[0]).toEqual(["Invalid environment configuration:"]);
    const formatted = errors[1][0] as Record<string, { _errors: string[] }>;
    expect(formatted.DATABASE_URL._errors.length).toBeGreaterThan(0);
    expect(formatted.MAX_SKILLS_INJECTED._errors.length).toBeGreaterThan(0);
  });
});
