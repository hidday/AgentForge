import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a space-separated argument string into tokens", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and filters out empty tokens", () => {
    expect(parseBaseArgs("  exec   -   ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   \t  ")).toEqual([]);
  });
});

describe("loadEnv failure path", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs the formatted validation error and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env = { ...originalEnv, DATABASE_URL: "not-a-valid-url" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not exit when DATABASE_URL is a valid URL", async () => {
    vi.resetModules();
    process.env = { ...originalEnv, DATABASE_URL: "postgresql://test:test@localhost:5432/test" };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit should not have been called");
    }) as never);

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
