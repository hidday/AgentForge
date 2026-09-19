import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("env", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("parseBaseArgs", () => {
    it("splits a whitespace-separated args string into tokens", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("--print --output-format json")).toEqual([
        "--print",
        "--output-format",
        "json",
      ]);
    });

    it("collapses repeated whitespace and filters out empty tokens", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("  exec   -   ")).toEqual(["exec", "-"]);
    });

    it("returns an empty array for an empty string", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("")).toEqual([]);
    });
  });

  describe("loadEnv failure path", () => {
    it("logs a formatted error and exits the process when required env vars are invalid", async () => {
      process.env.DATABASE_URL = "not-a-valid-url";

      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(((_code?: number) => {
          throw new Error("process.exit called");
        }) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

      expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
      // Second console.error call logs the zod-formatted error tree.
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("fails when DATABASE_URL is missing entirely", async () => {
      delete process.env.DATABASE_URL;

      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(((_code?: number) => {
          throw new Error("process.exit called");
        }) as never);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("loadEnv success path", () => {
    it("parses a valid environment and applies documented defaults", async () => {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      const { env } = await import("../../src/config/env.js");

      expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
      expect(env.AGENT_RUNTIME_MODE).toBe("mock");
      expect(env.CLAUDE_CODE_MODEL).toBe("claude-fable-5");
      expect(env.PORT).toBe(3100);
    });
  });
});
