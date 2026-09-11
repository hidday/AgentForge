import { describe, it, expect, vi, afterEach } from "vitest";

describe("parseBaseArgs", () => {
  it("splits on whitespace and filters out empty segments", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print   --output-format  json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for an empty or whitespace-only string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("trims leading and trailing whitespace around args", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  --flag ")).toEqual(["--flag"]);
  });
});

describe("env loading failure path", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs the validation error and exits the process when required env vars are invalid", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "not-a-valid-url";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("__process_exit_called__");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow(
      "__process_exit_called__",
    );

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
