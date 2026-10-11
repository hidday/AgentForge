import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { CliOutputSchema } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

const parser = new OutputParser();

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function parseStdout(stdout: string) {
  return parser.parse(stdout, CliOutputSchema);
}

describe("createMockProcessHandler", () => {
  it("returns well-formed ProcessResult envelope fields for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner" }));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes claude + 'planner' stdin to the planner mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Here is the implementation plan request" }),
    );
    const parsed = parseStdout(result.stdout);
    expect(parsed.stage).toBe("planner");
    expect(parsed.success).toBe(true);
  });

  it("routes claude + answer-researcher stdin to the answer-researcher mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "open questions to research" }),
    );
    const parsed = parseStdout(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("routes claude + plan-reviser stdin to the plan-reviser mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "You are the lead engineer doing plan revision" }),
    );
    const parsed = parseStdout(result.stdout);
    expect(parsed.stage).toBe("plan-reviser");
  });

  it("routes claude + remediation stdin to the remediation mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Please begin remediation of findings" }),
    );
    const parsed = parseStdout(result.stdout);
    expect(parsed.stage).toBe("remediation");
  });

  it("routes claude with unmatched stdin content to the executor mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "implement the feature please" }),
    );
    const parsed = parseStdout(result.stdout);
    expect(parsed.stage).toBe("executor");
  });

  it("routes codex + plan-review stdin to the plan-reviewer mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "the plan under review is attached" }),
    );
    const parsed = parseStdout(result.stdout);
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("alternates codex code-review verdicts: changes_requested first, then approved", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

    const firstParsed = parseStdout(first.stdout);
    const secondParsed = parseStdout(second.stdout);

    expect(firstParsed.stage).toBe("reviewer");
    expect(secondParsed.stage).toBe("reviewer");
    if (firstParsed.stage === "reviewer" && secondParsed.stage === "reviewer") {
      expect(firstParsed.payload.overallVerdict).toBe("changes_requested");
      expect(secondParsed.payload.overallVerdict).toBe("approved");
    }
  });

  it("keeps separate call counters for codex plan-review vs code-review calls", async () => {
    const handler = createMockProcessHandler();
    // A plan-reviewer call should not consume a code-review call slot.
    await handler(baseOptions({ command: "codex", stdinData: "plan under review" }));
    const codeReview = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const parsed = parseStdout(codeReview.stdout);
    if (parsed.stage === "reviewer") {
      expect(parsed.payload.overallVerdict).toBe("changes_requested");
    }
  });

  it("falls back to a failed planner envelope for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor", stdinData: "anything" }));
    // This envelope intentionally has an empty payload (not a valid Plan), so we
    // inspect the raw structured JSON directly rather than through the full schema.
    const block = parser.extractStructuredBlock(result.stdout);
    const data = parser.parseJson(block) as { success: boolean; stage: string; payload: unknown };
    expect(data.success).toBe(false);
    expect(data.stage).toBe("planner");
    expect(data.payload).toEqual({});
  });
});
