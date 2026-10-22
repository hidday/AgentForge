import { describe, it, expect, vi, afterEach } from "vitest";

describe("config/env", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("parseBaseArgs splits on whitespace and filters empty tokens", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print  --output-format   json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as never);

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
