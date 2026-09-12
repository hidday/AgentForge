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
    cwd: "/tmp",
    timeoutMs: 1000,
    stdinData: "",
    ...overrides,
  };
}

function extractPayload(stdout: string): unknown {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("wraps every stdout in STRUCTURED_OUTPUT_BEGIN/END markers with parseable JSON", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "implementation plan" }));

    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
    expect(() => extractPayload(result.stdout)).not.toThrow();
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("routes claude calls mentioning open questions to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Open Questions to Research" }),
    );
    const payload = extractPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("answer-researcher");
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("routes claude calls mentioning 'lead engineer' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "You are the lead engineer" }),
    );
    const payload = extractPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("plan-reviser");
    expect(CliOutputSchema.safeParse(payload).success).toBe(true);
  });

  it("routes claude calls mentioning 'implementation plan' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Write an implementation plan" }),
    );
    const payload = extractPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("planner");
    expect(CliOutputSchema.safeParse(payload).success).toBe(true);
  });

  it("routes claude calls mentioning 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "please remediate the findings" }),
    );
    const payload = extractPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("remediation");
    expect(CliOutputSchema.safeParse(payload).success).toBe(true);
  });

  it("falls back to the executor output for other claude calls", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "implement the feature now" }),
    );
    const payload = extractPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("executor");
    expect(CliOutputSchema.safeParse(payload).success).toBe(true);
  });

  it("routes codex calls mentioning 'plan under review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "the plan under review is..." }),
    );
    const payload = extractPayload(result.stdout) as { stage: string };
    expect(payload.stage).toBe("plan-reviewer");
    expect(CliOutputSchema.safeParse(payload).success).toBe(true);
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
    const firstPayload = extractPayload(first.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
    const secondPayload = extractPayload(second.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(secondPayload.stage).toBe("reviewer");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("keeps separate call counters across handler instances (fresh state per handler)", async () => {
    const handler1 = createMockProcessHandler();
    const handler2 = createMockProcessHandler();

    await handler1(baseOptions({ command: "codex", stdinData: "review" }));
    const secondHandlerFirstCall = await handler2(
      baseOptions({ command: "codex", stdinData: "review" }),
    );
    const payload = extractPayload(secondHandlerFirstCall.stdout) as {
      payload: { overallVerdict: string };
    };
    // A fresh handler should start its own call counter, so this is still the
    // "first" code-review call for handler2 and should be changes_requested.
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "bash", stdinData: "" }));
    const payload = extractPayload(result.stdout) as { success: boolean; stage: string };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
  });

  it("matches claude/codex commands by exact name as well as by path suffix", async () => {
    const handler = createMockProcessHandler();
    const exactMatch = await handler(baseOptions({ command: "claude", stdinData: "planner" }));
    const suffixMatch = await handler(
      baseOptions({ command: "/opt/bin/claude", stdinData: "planner" }),
    );
    expect(extractPayload(exactMatch.stdout)).toMatchObject({ stage: "planner" });
    expect(extractPayload(suffixMatch.stdout)).toMatchObject({ stage: "planner" });
  });
});
