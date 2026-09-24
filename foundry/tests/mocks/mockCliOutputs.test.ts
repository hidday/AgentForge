import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function opts(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/repo",
    timeoutMs: 1000,
    stdinData: "",
    ...overrides,
  };
}

function extractPayload(stdout: string): { stage: string; success: boolean } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = stdout.slice(start, end).trim();
  return JSON.parse(json) as { stage: string; success: boolean };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "implementation plan" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
  });

  it("routes claude stdin containing 'answer-researcher' to the answer-researcher stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "please act as answer-researcher" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'open questions to research' to the answer-researcher stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "Open Questions To Research below" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes claude stdin containing 'plan-reviser' to the plan-reviser stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "run as plan-reviser" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'lead engineer' to the plan-reviser stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "You are the lead engineer" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes claude stdin containing 'planner' to the planner stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "act as planner" }));
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes claude stdin containing 'remediat' to the remediation stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "begin remediation now" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("defaults unmatched claude stdin to the executor stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "do the work" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("recognizes the claude command by exact match too", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("routes codex stdin containing 'plan review' to the plan-reviewer stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "codex", stdinData: "starting plan review" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("routes codex stdin containing 'plan under review' to the plan-reviewer stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "codex", stdinData: "the plan under review is..." }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(opts({ command: "codex", stdinData: "review this diff" }));

    const firstPayload = JSON.parse(
      first.stdout.slice(
        first.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
        first.stdout.indexOf(STRUCTURED_OUTPUT_END),
      ),
    );
    const secondPayload = JSON.parse(
      second.stdout.slice(
        second.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
        second.stdout.indexOf(STRUCTURED_OUTPUT_END),
      ),
    );

    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("tracks codex plan-review and code-review call counts independently", async () => {
    const handler = createMockProcessHandler();
    // A plan-review call should not consume a code-review "changes_requested" slot.
    await handler(opts({ command: "codex", stdinData: "plan review please" }));
    const codeReview = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const payload = extractPayload(codeReview.stdout);
    expect(payload.stage).toBe("reviewer");
    expect((payload as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
      "changes_requested",
    );
  });

  it("recognizes the codex command by exact match too", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "codex", stdinData: "plan review" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns a failed planner stub for unrecognized commands", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "cursor", stdinData: "anything" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("planner");
    expect(payload.success).toBe(false);
  });

  it("keeps call counts scoped to a single handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = await handlerA(opts({ command: "codex", stdinData: "review this diff" }));
    const bFirst = await handlerB(opts({ command: "codex", stdinData: "review this diff" }));

    expect(extractPayload(aFirst.stdout).stage).toBe("reviewer");
    expect(
      (JSON.parse(
        aFirst.stdout.slice(
          aFirst.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          aFirst.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      ) as { payload: { overallVerdict: string } }).payload.overallVerdict,
    ).toBe("changes_requested");
    expect(
      (JSON.parse(
        bFirst.stdout.slice(
          bFirst.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          bFirst.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      ) as { payload: { overallVerdict: string } }).payload.overallVerdict,
    ).toBe("changes_requested");
  });
});
