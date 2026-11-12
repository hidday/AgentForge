import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config/env", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("parseBaseArgs", () => {
    it("splits a space-separated args string into tokens", async () => {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      const { parseBaseArgs } = await import("../../src/config/env.js");

      expect(parseBaseArgs("--print --output-format json")).toEqual([
        "--print",
        "--output-format",
        "json",
      ]);
    });

    it("collapses repeated whitespace and filters out empty tokens", async () => {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      const { parseBaseArgs } = await import("../../src/config/env.js");

      expect(parseBaseArgs("  --foo   bar\tbaz  ")).toEqual(["--foo", "bar", "baz"]);
    });

    it("returns an empty array for an empty string", async () => {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      const { parseBaseArgs } = await import("../../src/config/env.js");

      expect(parseBaseArgs("")).toEqual([]);
    });
  });

  describe("module-level env parsing failure path", () => {
    it("logs the validation errors and exits the process when required env vars are invalid", async () => {
      process.env.DATABASE_URL = "not-a-valid-url";

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("process.exit called");
      }) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

      expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
