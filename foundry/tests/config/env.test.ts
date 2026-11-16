import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("config/env", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("parseBaseArgs splits on whitespace and filters out empty tokens", async () => {
    vi.resetModules();
    const { parseBaseArgs } = await import("../../src/config/env.js");

    expect(parseBaseArgs("--print   --output-format  json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
    expect(parseBaseArgs("single")).toEqual(["single"]);
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("logs the validation error and exits the process when the environment is invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
