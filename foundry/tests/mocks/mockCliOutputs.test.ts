import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractStagePayload(stdout: string): { stage: string; success: boolean } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end));
}

describe("createMockProcessHandler", () => {
  it("returns a resolved ProcessResult shape with exitCode 0 and no timeout", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.stdout).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes claude + answer-researcher stdin to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes claude + 'open questions to research' stdin to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Here are the OPEN QUESTIONS TO RESEARCH:" }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes claude + plan-revision stdin to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "This is a plan revision request." }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes claude + 'lead engineer' stdin to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "You are a lead engineer." }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes claude + planner stdin to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Produce an implementation plan." }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("planner");
  });

  it("routes claude + remediation stdin to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Please remediate these findings." }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor output for claude when no keyword matches", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "do the work" }));
    expect(extractStagePayload(result.stdout).stage).toBe("executor");
  });

  it("routes codex + plan-review stdin to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "This plan under review needs a verdict." }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call, then approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

    const firstPayload = extractStagePayload(first.stdout) as unknown as {
      payload: { overallVerdict: string };
    };
    const secondPayload = extractStagePayload(second.stdout) as unknown as {
      payload: { overallVerdict: string };
    };
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("keeps per-handler call-count state independent across separate handler instances", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = (await handlerA(baseOptions({ command: "codex", stdinData: "review" })))
      .stdout;
    const bFirst = (await handlerB(baseOptions({ command: "codex", stdinData: "review" })))
      .stdout;

    const aPayload = extractStagePayload(aFirst) as unknown as {
      payload: { overallVerdict: string };
    };
    const bPayload = extractStagePayload(bFirst) as unknown as {
      payload: { overallVerdict: string };
    };
    expect(aPayload.payload.overallVerdict).toBe("changes_requested");
    expect(bPayload.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failed planner stub for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "unknown-tool" }));
    const payload = extractStagePayload(result.stdout);
    expect(payload.stage).toBe("planner");
    expect(payload.success).toBe(false);
  });

  it("matches claude/codex commands regardless of path prefix", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/opt/homebrew/bin/codex", stdinData: "review" }),
    );
    expect(extractStagePayload(result.stdout).stage).toBe("reviewer");
  });
});
