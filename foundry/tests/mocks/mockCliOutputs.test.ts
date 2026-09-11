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

function extractStage(stdout: string): string {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = JSON.parse(stdout.slice(start, end));
  return json.stage;
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed successful ProcessResult", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the executor." }));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
  });

  it("routes claude stdin containing 'answer-researcher' to the answer-researcher stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "You are the answer-researcher agent." }),
    );
    expect(extractStage(result.stdout)).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'open questions to research' to the answer-researcher stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Here are the open questions to research for this plan." }),
    );
    expect(extractStage(result.stdout)).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'plan revision' to the plan-reviser stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Perform a plan revision now." }));
    expect(extractStage(result.stdout)).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'plan-reviser' to the plan-reviser stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the plan-reviser." }));
    expect(extractStage(result.stdout)).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'lead engineer' to the plan-reviser stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Act as the lead engineer reviewing this plan." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'planner' to the planner stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the planner agent." }));
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes claude stdin containing 'implementation plan' to the planner stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Produce an implementation plan for this issue." }),
    );
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes claude stdin containing 'remediat' to the remediation stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "You must remediate the findings below." }),
    );
    expect(extractStage(result.stdout)).toBe("remediation");
  });

  it("falls back to the executor stage for unrecognized claude stdin", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Do the work." }));
    expect(extractStage(result.stdout)).toBe("executor");
  });

  it("matches claude by a command path ending in 'claude'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "You are the planner agent." }),
    );
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes codex stdin containing 'plan review' to the plan-reviewer stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "Perform a plan review." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("routes codex stdin containing 'plan-reviewer' to the plan-reviewer stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "You are the plan-reviewer." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("routes codex stdin containing 'plan under review' to the plan-reviewer stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "This plan under review needs a verdict." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("matches codex by a command path ending in 'codex'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/codex", stdinData: "Perform a plan review." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(baseOptions({ command: "codex", stdinData: "Review this diff." }));
    const second = await handler(
      baseOptions({ command: "codex", stdinData: "Review this diff." }),
    );

    expect(extractStage(first.stdout)).toBe("reviewer");
    expect(first.stdout).toContain("changes_requested");
    expect(extractStage(second.stdout)).toBe("reviewer");
    expect(second.stdout).toContain("\"overallVerdict\": \"approved\"");
  });

  it("keeps independent call counters for plan-review and code-review on the same handler instance", async () => {
    const handler = createMockProcessHandler();
    await handler(baseOptions({ command: "codex", stdinData: "Perform a plan review." }));
    const codeReview = await handler(
      baseOptions({ command: "codex", stdinData: "Review this diff." }),
    );
    // The plan-review call above must not have incremented the code-review counter,
    // so this is still the first code-review call and should request changes.
    expect(codeReview.stdout).toContain("changes_requested");
  });

  it("returns a failed planner stub for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor-agent", stdinData: "anything" }));
    const start = result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
    const end = result.stdout.indexOf(STRUCTURED_OUTPUT_END);
    const json = JSON.parse(result.stdout.slice(start, end));
    expect(json).toEqual({ success: false, stage: "planner", payload: {} });
  });

  it("treats missing stdinData as an empty string for content matching", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: undefined }));
    expect(extractStage(result.stdout)).toBe("executor");
  });
});
