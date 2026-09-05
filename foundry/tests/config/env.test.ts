import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("parseBaseArgs", () => {
    it("splits on whitespace and filters out empty tokens", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("--print --output-format json")).toEqual([
        "--print",
        "--output-format",
        "json",
      ]);
    });

    it("collapses repeated whitespace between arguments", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("--print   --force")).toEqual(["--print", "--force"]);
    });

    it("returns an empty array for an empty string", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("")).toEqual([]);
    });

    it("returns an empty array for a whitespace-only string", async () => {
      const { parseBaseArgs } = await import("../../src/config/env.js");
      expect(parseBaseArgs("   ")).toEqual([]);
    });
  });

  describe("loadEnv validation", () => {
    it("logs the validation error and exits the process when required env vars are invalid", async () => {
      process.env.DATABASE_URL = "not-a-valid-url";
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
        throw new Error("process.exit called");
      }) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

      expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("loads successfully and applies defaults when env vars are valid", async () => {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      delete process.env.LOG_LEVEL;
      const { env } = await import("../../src/config/env.js");
      expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
      expect(env.LOG_LEVEL).toBe("info");
      expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    });
  });
});
