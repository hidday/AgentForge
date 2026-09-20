import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
  CliOutputSchema,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp/repo",
    timeoutMs: 60000,
    stdinData: "",
    ...overrides,
  };
}

function extractStructuredPayload(stdout: string): unknown {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult envelope", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("dispatches a claude command with no special keywords to the executor output", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ command: "claude", stdinData: "just build it" }));

    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stage).toBe("executor");
    }
  });

  it("recognizes a claude binary invoked via an absolute path", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner: build a plan" }),
    );

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("planner");
  });

  it("dispatches to the answer-researcher output when stdin mentions researching open questions", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(
      baseOptions({ stdinData: "Please act as the answer-researcher for these open questions to research" }),
    );

    const payload = extractStructuredPayload(result.stdout) as { stage: string; payload: unknown };
    expect(payload.stage).toBe("answer-researcher");
  });

  it("dispatches to the plan-reviser output when stdin mentions plan revision", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ stdinData: "You are handling a PLAN REVISION task" }));

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("plan-reviser");
  });

  it("dispatches to the planner output when stdin mentions the implementation plan", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ stdinData: "Draft an implementation plan for this issue" }));

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("planner");
  });

  it("dispatches to the remediation output when stdin mentions remediation", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ stdinData: "Please remediate the review findings" }));

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("remediation");
  });

  it("is case-insensitive when matching stdin keywords", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ stdinData: "PLANNER: DO THE THING" }));

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("planner");
  });

  it("dispatches a codex plan-review request to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(
      baseOptions({ command: "codex", stdinData: "You are the plan-reviewer for this plan under review" }),
    );

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("recognizes a codex binary invoked via an absolute path", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(
      baseOptions({ command: "/opt/bin/codex", stdinData: "plan review please" }),
    );

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

    const firstPayload = extractStructuredPayload(first.stdout) as {
      payload: { overallVerdict: string };
    };
    const secondPayload = extractStructuredPayload(second.stdout) as {
      payload: { overallVerdict: string };
    };
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("keeps a separate call count for the plan-reviewer branch vs the code-review branch", async () => {
    const handler = createMockProcessHandler();

    // A plan-review call should not consume a code-review call slot.
    await handler(baseOptions({ command: "codex", stdinData: "plan-reviewer time" }));
    const codeReview = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

    const payload = extractStructuredPayload(codeReview.stdout) as {
      payload: { overallVerdict: string };
    };
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });

  it("resets call counters for each new handler instance", async () => {
    const handler1 = createMockProcessHandler();
    const handler2 = createMockProcessHandler();

    await handler1(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const secondHandlerFirstCall = await handler2(
      baseOptions({ command: "codex", stdinData: "review this diff" }),
    );

    const payload = extractStructuredPayload(secondHandlerFirstCall.stdout) as {
      payload: { overallVerdict: string };
    };
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure envelope for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ command: "bash", stdinData: "anything" }));

    const payload = extractStructuredPayload(result.stdout) as {
      success: boolean;
      stage: string;
      payload: unknown;
    };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
    expect(payload.payload).toEqual({});
  });

  it("handles a missing stdinData without throwing, treating it as empty", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ stdinData: undefined }));

    const payload = extractStructuredPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("executor");
  });

  it("produces output for every claude and codex branch that validates against CliOutputSchema", async () => {
    const handler = createMockProcessHandler();
    const cases: { command: string; stdinData: string }[] = [
      { command: "claude", stdinData: "answer-researcher open questions to research" },
      { command: "claude", stdinData: "plan revision" },
      { command: "claude", stdinData: "implementation plan" },
      { command: "claude", stdinData: "remediation please" },
      { command: "claude", stdinData: "build the feature" },
      { command: "codex", stdinData: "plan review" },
      { command: "codex", stdinData: "review the code" },
    ];

    for (const c of cases) {
      const result = await handler(baseOptions(c));
      const payload = extractStructuredPayload(result.stdout);
      const parsed = CliOutputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    }
  });
});
