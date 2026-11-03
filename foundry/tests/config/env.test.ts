import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

/** Minimal env that satisfies every required field in EnvSchema. */
function baseValidEnv(): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  };
}

async function importEnvModule() {
  return import("../../src/config/env.js");
}

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...baseValidEnv() };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("parseBaseArgs", () => {
    it("splits a whitespace-separated argument string into tokens", async () => {
      const { parseBaseArgs } = await importEnvModule();
      expect(parseBaseArgs("--print --output-format json")).toEqual([
        "--print",
        "--output-format",
        "json",
      ]);
    });

    it("collapses repeated whitespace and trims empty tokens", async () => {
      const { parseBaseArgs } = await importEnvModule();
      expect(parseBaseArgs("  --print   --force  ")).toEqual(["--print", "--force"]);
    });

    it("returns an empty array for an empty string", async () => {
      const { parseBaseArgs } = await importEnvModule();
      expect(parseBaseArgs("")).toEqual([]);
    });
  });

  describe("loadEnv defaults and coercion", () => {
    it("applies documented defaults when only the required field is set", async () => {
      const { env } = await importEnvModule();
      expect(env.PORT).toBe(3100);
      expect(env.AGENT_RUNTIME_MODE).toBe("mock");
      expect(env.CLAUDE_CODE_COMMAND).toBe("claude");
      expect(env.CLAUDE_CODE_MODEL).toBe("claude-fable-5");
      expect(env.CLAUDE_CODE_MODEL_RESEARCH).toBe("claude-opus-4-8");
      expect(env.CODEX_MODEL).toBe("gpt-5.6-sol");
      expect(env.CURSOR_MODEL).toBe("claude-4.7-opus");
      expect(env.AGENT_TIMEOUT_MS).toBe(120_000);
      expect(env.EXECUTOR_TIMEOUT_MS).toBe(3_600_000);
      expect(env.CHAT_TIMEOUT_MS).toBe(120_000);
      expect(env.REPOS_ROOT_PATH).toBe("./workspace");
      expect(env.REPOS_CONFIG_PATH).toBe("./repos.config.json");
      expect(env.LOG_LEVEL).toBe("info");
      expect(env.LINEAR_API_KEY).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.SYNC_ON_STARTUP).toBe(false);
      expect(env.NOTIFY_EMAIL_FROM).toBe("AgentForge <onboarding@resend.dev>");
      expect(env.FOUNDRY_UI_BASE_URL).toBe("http://localhost:5173");
      expect(env.NOTIFY_DEBOUNCE_HOURS).toBe(6);
      expect(env.MAX_SKILLS_PER_REPO).toBe(200);
      expect(env.MAX_SKILLS_INJECTED).toBe(3);
      expect(env.NOVELTY_SIMILARITY_THRESHOLD).toBe(0.5);
    });

    it("coerces numeric string env vars to numbers", async () => {
      process.env.PORT = "8080";
      process.env.AGENT_TIMEOUT_MS = "5000";
      process.env.NOTIFY_DEBOUNCE_HOURS = "2.5";
      const { env } = await importEnvModule();
      expect(env.PORT).toBe(8080);
      expect(env.AGENT_TIMEOUT_MS).toBe(5000);
      expect(env.NOTIFY_DEBOUNCE_HOURS).toBe(2.5);
    });

    it("honors explicit AGENT_RUNTIME_MODE and LOG_LEVEL enum values", async () => {
      process.env.AGENT_RUNTIME_MODE = "real";
      process.env.LOG_LEVEL = "trace";
      const { env } = await importEnvModule();
      expect(env.AGENT_RUNTIME_MODE).toBe("real");
      expect(env.LOG_LEVEL).toBe("trace");
    });

    it.each([
      ["true", true],
      ["1", true],
      ["false", false],
      ["0", false],
    ])("transforms SYNC_ON_STARTUP=%s to boolean %s", async (raw, expected) => {
      process.env.SYNC_ON_STARTUP = raw;
      const { env } = await importEnvModule();
      expect(env.SYNC_ON_STARTUP).toBe(expected);
    });

    it("passes through optional secrets when present", async () => {
      process.env.LINEAR_API_KEY = "lin_api_key";
      process.env.GITHUB_TOKEN = "ghp_token";
      process.env.RESEND_API_KEY = "resend_key";
      process.env.NOTIFY_EMAIL_TO = "ops@example.com";
      process.env.NOTIFY_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/x";
      const { env } = await importEnvModule();
      expect(env.LINEAR_API_KEY).toBe("lin_api_key");
      expect(env.GITHUB_TOKEN).toBe("ghp_token");
      expect(env.RESEND_API_KEY).toBe("resend_key");
      expect(env.NOTIFY_EMAIL_TO).toBe("ops@example.com");
      expect(env.NOTIFY_SLACK_WEBHOOK_URL).toBe("https://hooks.slack.com/services/x");
    });
  });

  describe("loadEnv validation failures", () => {
    function mockExitAndConsole() {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${String(code)})`);
      }) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      return { exitSpy, errorSpy };
    }

    it("exits the process and logs formatted errors when DATABASE_URL is missing", async () => {
      delete process.env.DATABASE_URL;
      const { exitSpy, errorSpy } = mockExitAndConsole();

      await expect(importEnvModule()).rejects.toThrow("process.exit(1)");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith("Invalid environment configuration:");
      // Second console.error call carries the zod formatted error tree.
      expect(errorSpy.mock.calls[1]?.[0]).toBeTruthy();
    });

    it("exits the process when DATABASE_URL is not a valid URL", async () => {
      process.env.DATABASE_URL = "not-a-valid-url";
      const { exitSpy } = mockExitAndConsole();

      await expect(importEnvModule()).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits the process when an enum field has an invalid value", async () => {
      process.env.AGENT_RUNTIME_MODE = "not-a-real-mode";
      const { exitSpy } = mockExitAndConsole();

      await expect(importEnvModule()).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits the process when a numeric field cannot be coerced", async () => {
      process.env.PORT = "not-a-number";
      const { exitSpy } = mockExitAndConsole();

      await expect(importEnvModule()).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits the process when MAX_SKILLS_INJECTED is out of its 1-10 bound", async () => {
      process.env.MAX_SKILLS_INJECTED = "11";
      const { exitSpy } = mockExitAndConsole();

      await expect(importEnvModule()).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits the process when NOVELTY_SIMILARITY_THRESHOLD is out of its 0-1 bound", async () => {
      process.env.NOVELTY_SIMILARITY_THRESHOLD = "1.5";
      const { exitSpy } = mockExitAndConsole();

      await expect(importEnvModule()).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
