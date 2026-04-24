import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().url(),
  AGENT_RUNTIME_MODE: z.enum(["mock", "real"]).default("mock"),
  CLAUDE_CODE_COMMAND: z.string().default("claude"),
  CLAUDE_CODE_ARGS_BASE: z.string().default("--print --output-format json"),
  CODEX_COMMAND: z.string().default("codex"),
  CODEX_ARGS_BASE: z.string().default("exec -"),
  CURSOR_COMMAND: z.string().default("agent"),
  CURSOR_ARGS_BASE: z.string().default("--print --output-format json --force --trust"),
  CURSOR_MODEL: z.string().default("claude-4.7-opus"),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  REPOS_ROOT_PATH: z.string().default("./workspace"),
  REPOS_CONFIG_PATH: z.string().default("./repos.config.json"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LINEAR_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  SYNC_ON_STARTUP: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // Retry loop: number of attempts (0 = no retry, just run once)
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(3),
  // Retry loop: base delay in ms before exponential backoff
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  // Circuit breaker: consecutive failure threshold before opening
  CB_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  // Circuit breaker: sliding window width in ms
  CB_WINDOW_MS: z.coerce.number().int().positive().default(60000),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseBaseArgs(argsString: string): string[] {
  return argsString.split(/\s+/).filter(Boolean);
}

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
