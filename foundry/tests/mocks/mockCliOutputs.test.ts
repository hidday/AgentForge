import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 60_000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end));
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult with a fast, non-timed-out completion", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the planner agent." }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes claude planner prompts to a planner-stage payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "Produce an implementation plan." }),
    );

    const payload = extractPayload(result.stdout);
    expect(payload.success).toBe(true);
    expect(payload.stage).toBe("planner");
  });

  it("routes claude answer-researcher prompts to the researcher-stage payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "You are the answer-researcher agent with open questions to research." }),
    );

    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("answer-researcher");
  });

  it("routes claude plan-revision prompts to the plan-reviser-stage payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "You are the lead engineer performing plan revision." }),
    );

    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviser");
  });

  it("routes claude remediation prompts to the remediation-stage payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Please remediate the review findings." }));

    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("remediation");
  });

  it("falls back to the executor-stage payload for unrecognized claude prompts", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Implement the approved plan." }));

    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("executor");
  });

  it("routes codex plan-review prompts to the plan-reviewer-stage payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "The plan is under review by the plan-reviewer." }),
    );

    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(baseOptions({ command: "codex", stdinData: "Review this PR diff." }));
    const second = await handler(baseOptions({ command: "codex", stdinData: "Review this PR diff." }));

    const firstPayload = extractPayload(first.stdout) as {
      payload: { overallVerdict?: string };
    };
    const secondPayload = extractPayload(second.stdout) as {
      payload: { overallVerdict?: string };
    };
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("tracks codex plan-review and code-review call counts independently per handler instance", async () => {
    const handler = createMockProcessHandler();

    // A plan-review call should not consume the code-review call counter.
    await handler(baseOptions({ command: "codex", stdinData: "plan review please" }));
    const codeReview1 = await handler(baseOptions({ command: "codex", stdinData: "review the diff" }));
    const payload1 = extractPayload(codeReview1.stdout) as { payload: { overallVerdict?: string } };

    expect(payload1.payload.overallVerdict).toBe("changes_requested");
  });

  it("gives each handler instance its own independent call-count state", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    await handlerA(baseOptions({ command: "codex", stdinData: "review the diff" }));
    const bFirstCall = await handlerB(baseOptions({ command: "codex", stdinData: "review the diff" }));

    const payload = extractPayload(bFirstCall.stdout) as { payload: { overallVerdict?: string } };
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failed planner-stage payload for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "unknown-tool", stdinData: "anything" }));

    const payload = extractPayload(result.stdout);
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
  });

  it("treats a missing stdinData as empty input rather than throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: undefined }));

    // No recognized keyword -> falls through to the executor default for claude.
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("executor");
  });
});
