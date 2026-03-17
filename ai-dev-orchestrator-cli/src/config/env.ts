import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().url(),
  AGENT_RUNTIME_MODE: z.enum(["mock", "real"]).default("mock"),
  CLAUDE_CODE_COMMAND: z.string().default("claude"),
  CODEX_COMMAND: z.string().default("codex"),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  DEFAULT_REPO_PATH: z.string().default("./workspace"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

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
