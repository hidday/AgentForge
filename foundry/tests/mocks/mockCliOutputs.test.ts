import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractPayload(stdout: string): { stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
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

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  it("routes claude stdin containing 'answer-researcher' to the answer-researcher mock", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "please act as answer-researcher" }),
    );

    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'open questions to research' to the answer-researcher mock", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Open Questions To Research: ..." }),
    );

    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes claude stdin mentioning 'lead engineer' to the plan-reviser mock", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "You are a lead engineer revising the plan" }),
    );

    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes claude stdin mentioning 'implementation plan' to the planner mock", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Write an implementation plan" }),
    );

    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes claude stdin mentioning 'remediat' to the remediation mock", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "Please remediate the findings" }),
    );

    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor mock for claude stdin matching no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "implement the plan" }),
    );

    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("matches a claude command given via an absolute path", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
    );

    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes codex stdin mentioning 'plan-reviewer' to the plan-reviewer mock", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "codex", stdinData: "You are the plan-reviewer" }),
    );

    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(makeOptions({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(makeOptions({ command: "codex", stdinData: "review this diff" }));

    const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
    const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };

    expect(firstPayload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("tracks separate call counts per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = await handlerA(makeOptions({ command: "codex", stdinData: "review" }));
    const bFirst = await handlerB(makeOptions({ command: "codex", stdinData: "review" }));

    expect((extractPayload(aFirst.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
    expect((extractPayload(bFirst.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "agent", stdinData: "anything" }));

    const parsed = extractPayload(result.stdout);
    expect(parsed).toMatchObject({ success: false, stage: "planner", payload: {} });
  });

  it("treats a missing stdinData as empty rather than throwing", async () => {
    const handler = createMockProcessHandler();
    const options = makeOptions({ command: "claude" });
    delete options.stdinData;

    const result = await handler(options);

    expect(extractPayload(result.stdout).stage).toBe("executor");
  });
});
