import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeOpts(overrides: Partial<ProcessSpawnOptions> & { command: string }): ProcessSpawnOptions {
  return { args: [], cwd: "/tmp", timeoutMs: 60_000, ...overrides };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim()) as {
    success: boolean;
    stage: string;
    payload: unknown;
  };
}

describe("createMockProcessHandler", () => {
  it("returns the answer-researcher mock output for a claude call mentioning answer-researcher", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOpts({
        command: "claude",
        stdinData: "You are the answer-researcher agent. Open Questions to Research: ...",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("returns the plan-reviser mock output for a claude call mentioning plan revision", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOpts({ command: "claude", stdinData: "Plan Revision task" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("returns the planner mock output for a claude call mentioning planner", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOpts({
        command: "/usr/local/bin/claude",
        stdinData: "You are the planner. Produce an implementation plan.",
      }),
    );
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("returns the remediation mock output for a claude call mentioning remediation", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOpts({ command: "claude", stdinData: "Please remediate findings" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("defaults to the executor mock output for an unrecognized claude call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOpts({ command: "claude", stdinData: "" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("returns the plan-reviewer mock output for a codex call mentioning plan review", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOpts({ command: "codex", stdinData: "Plan review requested" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(makeOpts({ command: "codex", stdinData: "Review this diff" }));
    const second = await handler(
      makeOpts({ command: "codex", stdinData: "Review this diff again" }),
    );

    const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
    const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };
    expect(firstPayload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("tracks plan-reviewer and code-review call counts independently per handler instance", async () => {
    const handler = createMockProcessHandler();
    await handler(makeOpts({ command: "codex", stdinData: "Plan review requested" }));
    const codeReview = await handler(
      makeOpts({ command: "codex", stdinData: "Review this diff" }),
    );
    // The plan-reviewer call should not have consumed a code-review call count,
    // so this first code-review call should still be "changes_requested".
    const payload = extractPayload(codeReview.stdout).payload as { overallVerdict: string };
    expect(payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure envelope for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOpts({ command: "some-other-tool", stdinData: "" }));
    const parsed = extractPayload(result.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
  });

  it("handles a missing stdinData by treating it as an empty string", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOpts({ command: "claude" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });
});
