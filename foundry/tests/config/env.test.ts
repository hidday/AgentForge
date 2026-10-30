import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBaseArgs } from "../../src/config/env.js";

describe("parseBaseArgs", () => {
  it("splits on whitespace and drops empty segments", () => {
    expect(parseBaseArgs("--print  --output-format   json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("returns an empty array for a blank string", () => {
    expect(parseBaseArgs("   ")).toEqual([]);
  });

  it("returns a single-element array for one token", () => {
    expect(parseBaseArgs("exec")).toEqual(["exec"]);
  });
});

describe("env validation failure", () => {
  afterEach(() => {
    delete process.env.PORT;
    vi.resetModules();
  });

  it("logs the validation error and exits the process when the schema fails to parse", async () => {
    process.env.PORT = "not-a-number";
    vi.resetModules();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
