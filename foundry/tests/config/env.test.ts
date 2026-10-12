import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("parseBaseArgs", () => {
  it("splits an args string on whitespace", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("filters out extra whitespace between flags", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  --foo   --bar  ")).toEqual(["--foo", "--bar"]);
  });

  it("returns an empty array for an empty string", async () => {
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
  });
});

describe("loadEnv (module initialization)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("logs the validation errors and exits the process when required env vars are invalid", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      // @ts-expect-error -- stub exit to not actually terminate the test process
      .mockImplementation(() => undefined);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("loads successfully when DATABASE_URL is a valid URL", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
  });
});
