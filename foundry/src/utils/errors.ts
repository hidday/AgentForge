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
