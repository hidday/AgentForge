import { AgentTimeoutError } from "../utils/errors.js";

const TRANSIENT_MESSAGE_PATTERNS = [
  "timeout",
  "timed out",
  "etimedout",
  "econnreset",
  "econnrefused",
  "rate limit",
  "out of memory",
  "oom",
];

const DETERMINISTIC_MESSAGE_PATTERNS = [
  "authentication",
  "unauthorized",
  "invalid api key",
  "invalid model",
  "model not found",
  "permission denied",
  "forbidden",
];

const TRANSIENT_EXIT_CODES = [
  137, // OOM / SIGKILL
  124, // timeout (GNU timeout)
];

function getStatusCode(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const code = e.statusCode ?? e.status;
    if (typeof code === "number") return code;
  }
  return undefined;
}

function getExitCode(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const code = e.exitCode ?? e.code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message.toLowerCase();
  if (typeof err === "string") return err.toLowerCase();
  return "";
}

/**
 * Returns true when the error is likely transient and worth retrying.
 * Unknown errors default to transient (fail-safe).
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof AgentTimeoutError) return true;

  const status = getStatusCode(err);
  if (status === 429) return true;

  const exitCode = getExitCode(err);
  if (exitCode !== undefined && TRANSIENT_EXIT_CODES.includes(exitCode)) return true;

  const msg = getMessage(err);
  if (TRANSIENT_MESSAGE_PATTERNS.some((p) => msg.includes(p))) return true;

  // If it's explicitly deterministic, return false; otherwise default to transient
  if (isDeterministicError(err)) return false;

  return true;
}

/**
 * Returns true when the error is deterministic (retrying will not help).
 */
export function isDeterministicError(err: unknown): boolean {
  const msg = getMessage(err);
  return DETERMINISTIC_MESSAGE_PATTERNS.some((p) => msg.includes(p));
}
