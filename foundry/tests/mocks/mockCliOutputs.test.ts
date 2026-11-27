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

function extractPayload(stdout: string): { stage: string; payload: unknown; success: boolean } {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(begin, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for any call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());

    expect(typeof result.stdout).toBe("string");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  it("wraps stdout with the structured-output begin/end markers", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  describe("Claude CLI command routing", () => {
    it("returns the answer-researcher payload when stdin mentions 'answer-researcher'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "This is the answer-researcher prompt" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("answer-researcher");
    });

    it("returns the answer-researcher payload when stdin mentions 'open questions to research'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "## Open Questions to Research" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("answer-researcher");
    });

    it("returns the plan-reviser payload when stdin mentions 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "please produce a plan revision" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("returns the plan-reviser payload when stdin mentions 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the lead engineer" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("returns the planner payload when stdin mentions 'implementation plan'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Write an implementation plan" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("returns the remediation payload when stdin mentions 'remediat'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Begin remediation of findings" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("remediation");
    });

    it("falls back to the executor payload for claude when stdin matches nothing specific", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "implement the feature now" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("falls back to the executor payload when stdinData is entirely absent", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude" }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("matches a command that merely ends with 'claude' (e.g. an absolute path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });
  });

  describe("Codex CLI command routing", () => {
    it("returns the plan-reviewer payload when stdin mentions 'plan review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Begin plan review of the proposal" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns the plan-reviewer payload when stdin mentions 'plan-reviewer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "You are the plan-reviewer" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns the plan-reviewer payload when stdin mentions 'plan under review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Here is the plan under review" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(
        baseOptions({ command: "codex", stdinData: "review this code change" }),
      );
      const firstPayload = extractPayload(first.stdout) as {
        stage: string;
        payload: { overallVerdict: string };
      };
      expect(firstPayload.stage).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(
        baseOptions({ command: "codex", stdinData: "review this code change" }),
      );
      const secondPayload = extractPayload(second.stdout) as {
        stage: string;
        payload: { overallVerdict: string };
      };
      expect(secondPayload.stage).toBe("reviewer");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });

    it("keeps returning approved on a third and later code-review call", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "review this code change" }));
      await handler(baseOptions({ command: "codex", stdinData: "review this code change" }));
      const third = await handler(
        baseOptions({ command: "codex", stdinData: "review this code change" }),
      );
      const payload = extractPayload(third.stdout) as { payload: { overallVerdict: string } };
      expect(payload.payload.overallVerdict).toBe("approved");
    });

    it("tracks code-review call counts independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      const aFirst = await handlerA(
        baseOptions({ command: "codex", stdinData: "review this code change" }),
      );
      expect(
        (extractPayload(aFirst.stdout) as { payload: { overallVerdict: string } }).payload
          .overallVerdict,
      ).toBe("changes_requested");

      // A fresh handler's call counter starts over, so it's independent of handlerA's state.
      const bFirst = await handlerB(
        baseOptions({ command: "codex", stdinData: "review this code change" }),
      );
      expect(
        (extractPayload(bFirst.stdout) as { payload: { overallVerdict: string } }).payload
          .overallVerdict,
      ).toBe("changes_requested");
    });
  });

  describe("unrecognized command", () => {
    it("returns a failure payload with stage 'planner' and an empty payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "some-other-tool" }));
      const payload = extractPayload(result.stdout) as {
        success: boolean;
        stage: string;
        payload: unknown;
      };
      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
      expect(payload.payload).toEqual({});
    });
  });
});
