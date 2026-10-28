import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function stageOf(stdout: string): string {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = JSON.parse(stdout.slice(begin, end).trim());
  return json.stage;
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  describe("claude command routing", () => {
    it("routes answer-researcher stdin to the answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Open questions to research..." }),
      );
      expect(stageOf(result.stdout)).toBe("answer-researcher");
    });

    it("routes plan-reviser stdin to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the lead engineer doing a plan revision" }),
      );
      expect(stageOf(result.stdout)).toBe("plan-reviser");
    });

    it("routes planner stdin to the planner output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Produce an implementation plan" }),
      );
      expect(stageOf(result.stdout)).toBe("planner");
    });

    it("routes remediation stdin to the remediation output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Please remediate the review findings" }),
      );
      expect(stageOf(result.stdout)).toBe("remediation");
    });

    it("defaults unmatched claude stdin to the executor output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "implement the plan" }),
      );
      expect(stageOf(result.stdout)).toBe("executor");
    });

    it("recognizes a command ending in /claude as the claude binary", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/claude", stdinData: "implement" }),
      );
      expect(stageOf(result.stdout)).toBe("executor");
    });
  });

  describe("codex command routing", () => {
    it("routes plan-reviewer stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "Plan under review, give feedback" }),
      );
      expect(stageOf(result.stdout)).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(makeOptions({ command: "codex", stdinData: "review this code" }));
      const second = await handler(makeOptions({ command: "codex", stdinData: "review this code" }));

      const firstJson = JSON.parse(
        first.stdout.slice(
          first.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          first.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      );
      const secondJson = JSON.parse(
        second.stdout.slice(
          second.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          second.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      );

      expect(firstJson.payload.overallVerdict).toBe("changes_requested");
      expect(secondJson.payload.overallVerdict).toBe("approved");
    });

    it("tracks plan-reviewer and code-review call counts independently", async () => {
      const handler = createMockProcessHandler();

      await handler(makeOptions({ command: "codex", stdinData: "Plan under review" }));
      const codeReview = await handler(makeOptions({ command: "codex", stdinData: "review this code" }));

      expect(stageOf(codeReview.stdout)).toBe("reviewer");
      const json = JSON.parse(
        codeReview.stdout.slice(
          codeReview.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          codeReview.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      );
      expect(json.payload.overallVerdict).toBe("changes_requested");
    });
  });

  it("returns a failure payload for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "cursor" }));

    const json = JSON.parse(
      result.stdout.slice(
        result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
        result.stdout.indexOf(STRUCTURED_OUTPUT_END),
      ),
    );
    expect(json).toEqual({ success: false, stage: "planner", payload: {} });
  });
});
