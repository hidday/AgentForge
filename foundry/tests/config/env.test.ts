import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseBaseArgs("")).toEqual([]);
  });

  it("splits a single token with no spaces", () => {
    expect(parseBaseArgs("--print")).toEqual(["--print"]);
  });

  it("splits multiple tokens on whitespace", () => {
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("filters out extra tokens produced by repeated/leading/trailing whitespace", () => {
    expect(parseBaseArgs("  exec   -  ")).toEqual(["exec", "-"]);
  });
});

describe("env - invalid configuration at load time", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs the validation errors and exits the process when DATABASE_URL is missing", async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs the validation errors and exits the process when DATABASE_URL is not a valid URL", async () => {
    vi.resetModules();
    process.env = { ...originalEnv, DATABASE_URL: "not-a-valid-url" };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("../../src/config/env.js");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not log errors or exit when the configuration is valid", async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const mod = await import("../../src/config/env.js");

    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mod.env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
  });
});
