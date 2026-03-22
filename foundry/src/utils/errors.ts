export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class AgentTimeoutError extends Error {
  constructor(
    public readonly agent: string,
    public readonly timeoutMs: number,
  ) {
    super(`Agent "${agent}" timed out after ${timeoutMs}ms`);
    this.name = "AgentTimeoutError";
  }
}

export class OutputParseError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
  ) {
    super(message);
    this.name = "OutputParseError";
  }
}

export class StateTransitionError extends Error {
  constructor(
    public readonly fromState: string,
    public readonly event: string,
  ) {
    super(`No transition from state "${fromState}" for event "${event}"`);
    this.name = "StateTransitionError";
  }
}

export interface PreflightSummary {
  ok: boolean;
  requiredRuntimes: string[];
  results: {
    runtime: string;
    command: string;
    binaryCheck: { ok: boolean; version?: string; error?: string; durationMs: number };
    authCheck: { ok: boolean; durationMs: number; error?: string };
  }[];
}

export class PreflightError extends Error {
  public readonly result: PreflightSummary;

  constructor(result: PreflightSummary) {
    const failures = result.results
      .filter((r) => !r.binaryCheck.ok || !r.authCheck.ok)
      .map((r) => r.runtime);
    super(`Preflight failed for runtimes: ${failures.join(", ")}`);
    this.name = "PreflightError";
    this.result = result;
  }
}
