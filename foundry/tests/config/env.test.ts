import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// This module has a module-level side effect (`export const env = loadEnv();`)
// that reads `process.env` at import time and calls `process.exit(1)` on
// invalid configuration. To exercise both the success and failure paths we
// mutate `process.env` and re-import the module fresh (`vi.resetModules()`)
// for each case, mocking `process.exit`/`console.error` so a failing case
// doesn't actually kill the test worker.

const ORIGINAL_ENV = { ...process.env };

describe("config/env", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("parseBaseArgs", () => {
    it("splits a whitespace-separated args string into non-empty tokens", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("--print   --output-format  json")).toEqual([
        "--print",
        "--output-format",
        "json",
      ]);
    });

    it("returns an empty array for an empty string", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("")).toEqual([]);
    });

    it("collapses tabs/newlines and trims leading/trailing whitespace", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("  exec\t-\n")).toEqual(["exec", "-"]);
    });
  });

  describe("loadEnv (module-level env parsing)", () => {
    it("parses valid environment variables and applies schema defaults", async () => {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      delete process.env.PORT;
      delete process.env.AGENT_RUNTIME_MODE;

      const { env } = await import("../../src/config/env.js");

      expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
      expect(env.PORT).toBe(3100);
      expect(env.AGENT_RUNTIME_MODE).toBe("mock");
      expect(env.CLAUDE_CODE_MODEL).toBe("claude-fable-5");
    });

    it("logs an error and calls process.exit(1) when required env vars are invalid/missing", async () => {
      // DATABASE_URL is required (z.string().url()) and has no default;
      // deleting it makes EnvSchema.safeParse(process.env) fail.
      delete process.env.DATABASE_URL;

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit(1) called");
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(import("../../src/config/env.js")).rejects.toThrow(
        "process.exit(1) called",
      );

      expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
      // Second console.error call carries the formatted zod error.
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
