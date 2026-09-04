import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText) as { success: boolean; stage: string; payload: unknown };
}

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 60_000,
    stdinData: "",
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult for a basic claude call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.stdout).toBe("string");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  it("recognizes claude via a path ending in the claude binary name", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("planner");
  });

  it("routes claude stdin containing 'answer-researcher' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'open questions to research' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Here are the OPEN QUESTIONS TO RESEARCH" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'plan revision' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Produce a PLAN REVISION for step s1" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'plan-reviser' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "plan-reviser" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'lead engineer' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "You are the LEAD ENGINEER" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'planner' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "You are planner" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("planner");
  });

  it("routes claude stdin containing 'implementation plan' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Write an implementation plan" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("planner");
  });

  it("routes claude stdin containing 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Please remediate the review findings" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("remediation");
  });

  it("falls back to the executor output for claude stdin matching no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Implement the feature now" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("executor");
  });

  it("routes codex stdin containing 'plan review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "codex", stdinData: "Perform a plan review" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("routes codex stdin containing 'plan-reviewer' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "codex", stdinData: "plan-reviewer" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("routes codex stdin containing 'plan under review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "codex", stdinData: "The plan under review is v2" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("recognizes codex via a path ending in the codex binary name", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("returns a changes_requested code review on the first codex code-review call, then approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(
      makeOptions({ command: "codex", stdinData: "Please review this diff" }),
    );
    const firstPayload = extractPayload(first.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(
      makeOptions({ command: "codex", stdinData: "Please review this diff" }),
    );
    const secondPayload = extractPayload(second.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(secondPayload.stage).toBe("reviewer");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("keeps returning approved on a third and later codex code-review calls", async () => {
    const handler = createMockProcessHandler();
    await handler(makeOptions({ command: "codex", stdinData: "review" }));
    await handler(makeOptions({ command: "codex", stdinData: "review" }));
    const third = await handler(makeOptions({ command: "codex", stdinData: "review" }));
    const payload = extractPayload(third.stdout) as { payload: { overallVerdict: string } };
    expect(payload.payload.overallVerdict).toBe("approved");
  });

  it("tracks the plan-reviewer and code-review call counters independently", async () => {
    const handler = createMockProcessHandler();

    // A plan-review call should not consume the code-review counter.
    await handler(makeOptions({ command: "codex", stdinData: "plan review" }));
    const firstCodeReview = await handler(
      makeOptions({ command: "codex", stdinData: "review the code" }),
    );
    const payload = extractPayload(firstCodeReview.stdout) as {
      payload: { overallVerdict: string };
    };
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure planner payload when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "some-other-tool", stdinData: "" }));
    const payload = extractPayload(result.stdout) as { success: boolean; stage: string };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
  });

  it("matches stdin case-insensitively", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "REMEDIATE the findings" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("remediation");
  });

  it("treats a missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const options = makeOptions({ command: "claude" });
    delete options.stdinData;
    const result = await handler(options);
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("executor");
  });

  it("keeps call-count state independent across two separately created handlers", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    await handlerA(makeOptions({ command: "codex", stdinData: "review" }));
    // handlerB's first code-review call should still be "changes_requested".
    const result = await handlerB(makeOptions({ command: "codex", stdinData: "review" }));
    const payload = extractPayload(result.stdout) as { payload: { overallVerdict: string } };
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });
});
