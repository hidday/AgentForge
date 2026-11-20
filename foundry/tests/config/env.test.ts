import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config/env", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("parseBaseArgs", () => {
    it("splits a space-separated args string into tokens", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("--print --output-format json")).toEqual([
        "--print",
        "--output-format",
        "json",
      ]);
    });

    it("collapses repeated whitespace and drops empty tokens", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("  exec   -   ")).toEqual(["exec", "-"]);
    });

    it("returns an empty array for an empty string", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("")).toEqual([]);
    });

    it("returns a single-element array for a single token", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("claude")).toEqual(["claude"]);
    });
  });

  describe("loadEnv (module-level env export)", () => {
    it("parses process.env successfully and applies documented defaults", async () => {
      process.env = {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      };
      delete process.env.PORT;
      delete process.env.AGENT_RUNTIME_MODE;
      delete process.env.LOG_LEVEL;

      const { env } = await import("../../src/config/env.js");

      expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
      expect(env.PORT).toBe(3100);
      expect(env.AGENT_RUNTIME_MODE).toBe("mock");
      expect(env.LOG_LEVEL).toBe("info");
      expect(env.CLAUDE_CODE_COMMAND).toBe("claude");
    });

    it("coerces numeric and boolean-like string env vars", async () => {
      process.env = {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        PORT: "4200",
        AGENT_TIMEOUT_MS: "5000",
        SYNC_ON_STARTUP: "true",
        MAX_SKILLS_INJECTED: "2",
        NOVELTY_SIMILARITY_THRESHOLD: "0.75",
      };

      const { env } = await import("../../src/config/env.js");

      expect(env.PORT).toBe(4200);
      expect(env.AGENT_TIMEOUT_MS).toBe(5000);
      expect(env.SYNC_ON_STARTUP).toBe(true);
      expect(env.MAX_SKILLS_INJECTED).toBe(2);
      expect(env.NOVELTY_SIMILARITY_THRESHOLD).toBe(0.75);
    });

    it("transforms SYNC_ON_STARTUP '0' and '1' to booleans", async () => {
      process.env = {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        SYNC_ON_STARTUP: "0",
      };

      const { env } = await import("../../src/config/env.js");
      expect(env.SYNC_ON_STARTUP).toBe(false);
    });

    it("logs an error and exits the process when validation fails (invalid DATABASE_URL)", async () => {
      process.env = {
        ...process.env,
        DATABASE_URL: "not-a-valid-url",
      };
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
        // Intentionally does not throw/exit so the module finishes evaluating,
        // mirroring that in a real process exit() would halt execution, but
        // letting us assert both calls happened without killing the test run.
        return undefined as never;
      }) as unknown) as typeof process.exit);

      await import("../../src/config/env.js");

      expect(consoleErrorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it("logs an error and exits the process when a required field is missing (DATABASE_URL)", async () => {
      const env = { ...process.env };
      delete env.DATABASE_URL;
      process.env = env;

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined as never) as never);

      await import("../../src/config/env.js");

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
