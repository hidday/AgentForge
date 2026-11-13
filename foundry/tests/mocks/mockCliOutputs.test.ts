import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
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

function extractPayload(stdout: string): { stage: string; payload: Record<string, unknown> } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText) as { stage: string; payload: Record<string, unknown> };
}

describe("createMockProcessHandler", () => {
  it("returns a ProcessResult shape with exitCode 0 and timedOut false", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "executor task" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("recognizes a command that is exactly 'claude'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner implementation plan" }));
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("recognizes a command whose path ends with 'claude'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner implementation plan" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  describe("claude command routing by stdin content", () => {
    it("routes to answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Please act as answer-researcher for these open questions to research" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes to plan-reviser output on 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "This is a plan revision task" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to plan-reviser output on 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "You are a lead engineer revising the plan" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to planner output on 'implementation plan'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Write an implementation plan" }));
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("routes to remediation output on 'remediat'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Please remediate the review findings" }));
      expect(extractPayload(result.stdout).stage).toBe("remediation");
    });

    it("falls back to executor output when stdin matches no known keyword", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "implement the feature please" }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("falls back to executor output when stdinData is undefined", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: undefined }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("matching is case-insensitive", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "PLANNER IMPLEMENTATION PLAN" }));
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("recognizes a command that is exactly 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "plan review" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("recognizes a command whose path ends with 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("routes to plan-reviewer output on 'plan-reviewer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "acting as plan-reviewer" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("routes to plan-reviewer output on 'plan under review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "the plan under review is attached" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("does not increment the code-review counter on a plan-review call", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "plan review" }));
      // First actual code-review call after a plan-review call should still be
      // treated as the FIRST code-review call (changes_requested), proving the
      // plan-review branch didn't consume a code-review counter slot.
      const result = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("reviewer");
      expect(payload.payload.overallVerdict).toBe("changes_requested");
    });

    it("returns changes_requested on the first code-review call", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("reviewer");
      expect(payload.payload.overallVerdict).toBe("changes_requested");
    });

    it("returns approved on the second code-review call from the same handler instance", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const payload = extractPayload(second.stdout);
      expect(payload.payload.overallVerdict).toBe("approved");
    });

    it("keeps returning approved on a third and later code-review call", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const third = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const payload = extractPayload(third.stdout);
      expect(payload.payload.overallVerdict).toBe("approved");
    });

    it("tracks the code-review call counter independently across separate handler instances", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      await handlerA(baseOptions({ command: "codex", stdinData: "review this diff" }));
      // A fresh handler instance should start its own counter from zero.
      const firstForB = await handlerB(baseOptions({ command: "codex", stdinData: "review this diff" }));
      expect(extractPayload(firstForB.stdout).payload.overallVerdict).toBe("changes_requested");
    });
  });

  it("returns a failure payload with stage 'planner' when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "some-other-tool" }));
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("planner");
    expect((payload as unknown as { success: boolean }).success).toBe(false);
    expect(payload.payload).toEqual({});
  });
});
