import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 120_000,
    stdinData: "",
    ...overrides,
  };
}

interface MockCliPayload {
  success: boolean;
  stage: string;
  payload: { overallVerdict?: string } & Record<string, unknown>;
}

function extractPayload(stdout: string): MockCliPayload {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const json = stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(json) as MockCliPayload;
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "planner task" }));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.stdout).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it.each([
      ["answer-researcher", "answer-researcher"],
      ["open questions to research", "answer-researcher"],
      ["please review this plan revision", "plan-reviser"],
      ["plan-reviser stage", "plan-reviser"],
      ["you are the lead engineer", "plan-reviser"],
      ["you are the planner", "planner"],
      ["create an implementation plan", "planner"],
      ["please remediate the findings", "remediation"],
    ])("routes stdin containing %j to the %s mock output", async (needle, expectedStage) => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: `Some preamble. ${needle} More text.` }),
      );

      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe(expectedStage);
    });

    it("is case-insensitive when matching routing keywords (stdin is lowercased)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "ANSWER-RESEARCHER please help" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("answer-researcher");
    });

    it("falls back to the executor mock output when no keyword matches", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "implement the feature now" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("executor");
    });

    it("matches via a command that merely ends with 'claude' (e.g. an absolute path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/claude", stdinData: "you are the planner" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("planner");
    });

    it("treats a missing stdinData as an empty string without throwing", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "claude", stdinData: undefined }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("executor");
    });
  });

  describe("codex command routing", () => {
    it("routes plan-review stdin to the plan-reviewer mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "this is a plan review request" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("matches via a command that merely ends with 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/codex", stdinData: "plan-reviewer stage" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(
        makeOptions({ command: "codex", stdinData: "please review this code diff" }),
      );
      const firstPayload = extractPayload(first.stdout);
      expect(firstPayload.stage).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(
        makeOptions({ command: "codex", stdinData: "please review this code diff again" }),
      );
      const secondPayload = extractPayload(second.stdout);
      expect(secondPayload.stage).toBe("reviewer");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });

    it("keeps returning approved on a third and later code-review call", async () => {
      const handler = createMockProcessHandler();
      await handler(makeOptions({ command: "codex", stdinData: "review 1" }));
      await handler(makeOptions({ command: "codex", stdinData: "review 2" }));
      const third = await handler(makeOptions({ command: "codex", stdinData: "review 3" }));
      const payload = extractPayload(third.stdout);
      expect(payload.payload.overallVerdict).toBe("approved");
    });

    it("keeps independent call counters across separate handler instances", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      const firstA = await handlerA(makeOptions({ command: "codex", stdinData: "review" }));
      const firstB = await handlerB(makeOptions({ command: "codex", stdinData: "review" }));

      const payloadA = extractPayload(firstA.stdout);
      const payloadB = extractPayload(firstB.stdout);
      expect(payloadA.payload.overallVerdict).toBe("changes_requested");
      expect(payloadB.payload.overallVerdict).toBe("changes_requested");
    });
  });

  describe("unrecognized command", () => {
    it("returns a success:false planner stub payload for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "some-other-cli", stdinData: "hello" }));

      const payload = extractPayload(result.stdout);
      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
      expect(payload.payload).toEqual({});
    });
  });
});
