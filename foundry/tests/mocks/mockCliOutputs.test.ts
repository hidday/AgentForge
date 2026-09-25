import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
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
    timeoutMs: 1000,
    stdinData: "",
    ...overrides,
  };
}

describe("createMockProcessHandler — generic ProcessResult shape", () => {
  it("returns a well-formed ProcessResult for any input", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions());

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });
});

describe("createMockProcessHandler — claude routing", () => {
  it.each([
    ["claude", "answer-researcher"],
    ["/usr/local/bin/claude", "open questions to research"],
  ])("routes command=%s stdin containing %s to the answer-researcher stage", async (command, needle) => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command, stdinData: `Please act as ${needle}` }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("answer-researcher");
    expect(payload.success).toBe(true);
  });

  it.each(["plan revision", "plan-reviser", "lead engineer"])(
    "routes claude stdin containing '%s' to the plan-reviser stage",
    async (needle) => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: `context: ${needle}` }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviser");
    },
  );

  it.each(["planner", "implementation plan"])(
    "routes claude stdin containing '%s' to the planner stage",
    async (needle) => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: `You are the ${needle}` }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("planner");
    },
  );

  it("routes claude stdin containing 'remediat' to the remediation stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ stdinData: "Please remediate the findings" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("remediation");
  });

  it("falls back to the executor stage for claude stdin matching no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ stdinData: "implement the plan" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("executor");
  });

  it("matches keywords case-insensitively (uppercase input)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ stdinData: "PLANNER MODE" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("planner");
  });

  it("treats a missing stdinData as an empty string and falls back to executor", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ stdinData: undefined }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("executor");
  });
});

describe("createMockProcessHandler — codex routing", () => {
  it.each([
    ["codex", "plan review"],
    ["/opt/bin/codex", "plan under review"],
  ])("routes command=%s stdin containing %s to the plan-reviewer stage", async (command, needle) => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command, stdinData: needle }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(makeOptions({ command: "codex", stdinData: "review this diff" }));
    const firstPayload = extractPayload(first.stdout) as {
      stage: string;
      payload: { overallVerdict: string; reviewId: string };
    };
    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
    expect(firstPayload.payload.reviewId).toBe("rev-001");

    const second = await handler(makeOptions({ command: "codex", stdinData: "review this diff" }));
    const secondPayload = extractPayload(second.stdout) as {
      stage: string;
      payload: { overallVerdict: string; reviewId: string };
    };
    expect(secondPayload.stage).toBe("reviewer");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
    expect(secondPayload.payload.reviewId).toBe("rev-002");
  });

  it("keeps returning approved on a third and later code-review call", async () => {
    const handler = createMockProcessHandler();
    await handler(makeOptions({ command: "codex", stdinData: "review" }));
    await handler(makeOptions({ command: "codex", stdinData: "review" }));
    const third = await handler(makeOptions({ command: "codex", stdinData: "review" }));
    const payload = extractPayload(third.stdout) as { payload: { overallVerdict: string } };
    expect(payload.payload.overallVerdict).toBe("approved");
  });

  it("keeps separate call counters per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    await handlerA(makeOptions({ command: "codex", stdinData: "review" }));
    const firstOnB = await handlerB(makeOptions({ command: "codex", stdinData: "review" }));
    const payload = extractPayload(firstOnB.stdout) as { payload: { overallVerdict: string } };
    expect(payload.payload.overallVerdict).toBe("changes_requested");
  });
});

describe("createMockProcessHandler — unknown command", () => {
  it("returns a failure payload with stage planner and an empty payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "some-other-tool", stdinData: "anything" }));
    const payload = extractPayload(result.stdout);
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
    expect(payload.payload).toEqual({});
  });
});
