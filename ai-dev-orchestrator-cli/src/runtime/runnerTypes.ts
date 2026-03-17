import type { Stage } from "../schemas/cliProtocol.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export interface AgentInput {
  prompt: string;
  systemPrompt?: string;
  workingDirectory: string;
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface AgentOutput<T = unknown> {
  raw: string;
  parsed: T;
  success: boolean;
  stage: Stage;
  durationMs: number;
}

export interface ProcessSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
}
