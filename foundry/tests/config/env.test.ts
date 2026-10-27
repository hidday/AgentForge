import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits a space-separated args string into tokens", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and ignores leading/trailing whitespace", () => {
    expect(parseBaseArgs("  --foo   --bar  ")).toEqual(["--foo", "--bar"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for a single token", () => {
    expect(parseBaseArgs("exec")).toEqual(["exec"]);
  });
});

describe("loadEnv (module-level env export)", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("logs the validation errors and exits the process when required env vars are invalid", async () => {
    process.env.DATABASE_URL = "not-a-valid-url";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      // @ts-expect-error -- test double that halts execution like the real process.exit
      .mockImplementation(() => {
        throw new Error("process.exit(1) called");
      });

    vi.resetModules();
    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1) called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("parses successfully and applies defaults when the env is valid", async () => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.LOG_LEVEL;
    delete process.env.AGENT_RUNTIME_MODE;

    vi.resetModules();
    const { env } = await import("../../src/config/env.js");

    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.PORT).toBe(3100);
  });
});
