import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const BASE_ENV = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
};

describe("env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("applies defaults for optional fields when only required fields are set", async () => {
    process.env = { ...BASE_ENV };
    const { env } = await import("../../src/config/env.js");
    expect(env.PORT).toBe(3100);
    expect(env.AGENT_RUNTIME_MODE).toBe("mock");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.SYNC_ON_STARTUP).toBe(false);
    expect(env.NOTIFY_EMAIL_FROM).toBe("AgentForge <onboarding@resend.dev>");
  });

  it("coerces PORT from a numeric string", async () => {
    process.env = { ...BASE_ENV, PORT: "4500" };
    const { env } = await import("../../src/config/env.js");
    expect(env.PORT).toBe(4500);
  });

  it("transforms SYNC_ON_STARTUP='true' to boolean true", async () => {
    process.env = { ...BASE_ENV, SYNC_ON_STARTUP: "true" };
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(true);
  });

  it("transforms SYNC_ON_STARTUP='1' to boolean true", async () => {
    process.env = { ...BASE_ENV, SYNC_ON_STARTUP: "1" };
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(true);
  });

  it("transforms SYNC_ON_STARTUP='0' to boolean false", async () => {
    process.env = { ...BASE_ENV, SYNC_ON_STARTUP: "0" };
    const { env } = await import("../../src/config/env.js");
    expect(env.SYNC_ON_STARTUP).toBe(false);
  });

  it("rejects an invalid SYNC_ON_STARTUP value (not in the enum)", async () => {
    process.env = { ...BASE_ENV, SYNC_ON_STARTUP: "yes" };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exits the process when DATABASE_URL is missing", async () => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exits the process when DATABASE_URL is not a valid URL", async () => {
    process.env = { ...BASE_ENV, DATABASE_URL: "not-a-url" };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("rejects an invalid AGENT_RUNTIME_MODE (not 'mock' or 'real')", async () => {
    process.env = { ...BASE_ENV, AGENT_RUNTIME_MODE: "bogus" };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("accepts a fully-specified environment including optional keys", async () => {
    process.env = {
      ...BASE_ENV,
      LINEAR_API_KEY: "lin_key",
      GITHUB_TOKEN: "gh_token",
      NOTIFY_EMAIL_TO: "ops@example.com",
      NOTIFY_SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/x",
      RESEND_API_KEY: "resend_key",
      LOG_LEVEL: "debug",
    };
    const { env } = await import("../../src/config/env.js");
    expect(env.LINEAR_API_KEY).toBe("lin_key");
    expect(env.GITHUB_TOKEN).toBe("gh_token");
    expect(env.NOTIFY_EMAIL_TO).toBe("ops@example.com");
    expect(env.NOTIFY_SLACK_WEBHOOK_URL).toBe("https://hooks.slack.com/services/x");
    expect(env.RESEND_API_KEY).toBe("resend_key");
    expect(env.LOG_LEVEL).toBe("debug");
  });
});

describe("parseBaseArgs", () => {
  it("splits a simple space-separated argument string", async () => {
    process.env = { ...BASE_ENV };
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("--print --output-format json")).toEqual([
      "--print",
      "--output-format",
      "json",
    ]);
  });

  it("collapses repeated whitespace and trims leading/trailing space", async () => {
    process.env = { ...BASE_ENV };
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("  exec   -   ")).toEqual(["exec", "-"]);
  });

  it("returns an empty array for an empty string", async () => {
    process.env = { ...BASE_ENV };
    const { parseBaseArgs } = await import("../../src/config/env.js");
    expect(parseBaseArgs("")).toEqual([]);
  });
});
