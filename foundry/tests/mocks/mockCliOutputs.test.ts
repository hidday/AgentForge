import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function opts(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { stage: string; payload: unknown; success: boolean } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end));
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed successful ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "please plan this" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("routes a claude call mentioning 'answer-researcher' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "Answer-Researcher: open questions to research here" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'plan revision' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "Perform a plan revision" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'implementation plan' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "Write the implementation plan" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a claude call mentioning 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "time to remediate findings" }));
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor output for an unrecognized claude call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "just do the work" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("matches claude command by exact match or path suffix (e.g. /usr/bin/claude)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "/usr/bin/claude", stdinData: "write the implementation plan" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a codex call mentioning 'plan-reviewer' to the plan reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "codex", stdinData: "run the plan-reviewer over this plan under review" }),
    );
    const payload = extractPayload(result.stdout).payload as { overallVerdict?: string };
    expect(payload).toBeDefined();
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(opts({ command: "codex", stdinData: "review this diff" }));

    const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
    const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };

    expect(firstPayload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("keeps independent call counters for plan-reviewer vs code-review calls under the same handler instance", async () => {
    const handler = createMockProcessHandler();
    await handler(opts({ command: "codex", stdinData: "plan under review please" }));
    const codeReview1 = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const codeReview2 = await handler(opts({ command: "codex", stdinData: "review this diff" }));

    expect((extractPayload(codeReview1.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
    expect((extractPayload(codeReview2.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
      "approved",
    );
  });

  it("returns a failed planner payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "some-other-cli", stdinData: "anything" }));
    const parsed = extractPayload(result.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
  });

  it("treats missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: undefined }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });
});
