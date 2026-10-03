import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  CliOutputSchema,
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
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

function extractStructuredPayload(stdout: string): unknown {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const jsonText = stdout.slice(start + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "planner task" }));

    expect(typeof result.stdout).toBe("string");
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("dispatches to the planner output for claude calls mentioning 'implementation plan'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "Write an implementation plan" }),
    );
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stage).toBe("planner");
      expect(parsed.data.payload.steps.length).toBeGreaterThan(0);
    }
  });

  it("dispatches to the answer-researcher output when stdin mentions research", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Here are the open questions to research." }),
    );
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.stage === "answer-researcher") {
      expect(parsed.data.payload.answers.length).toBeGreaterThan(0);
    } else {
      throw new Error(`expected stage answer-researcher, got ${parsed.success ? parsed.data.stage : "invalid"}`);
    }
  });

  it("dispatches to the plan-reviser output when stdin mentions plan revision", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Produce a plan revision now." }));
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.stage).toBe("plan-reviser");
  });

  it("dispatches to the remediation output when stdin mentions remediation", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Please remediate the findings." }));
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.stage).toBe("remediation");
  });

  it("falls back to the executor output for claude calls that match no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "implement the feature now" }));
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stage).toBe("executor");
      expect(parsed.data.payload.filesChanged.length).toBeGreaterThan(0);
    }
  });

  it("dispatches codex calls mentioning plan review to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "The plan under review is attached." }),
    );
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stage).toBe("plan-reviewer");
      expect(parsed.data.payload.overallVerdict).toBe("changes_requested");
    }
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const firstPayload = extractStructuredPayload(first.stdout);
    const firstParsed = CliOutputSchema.safeParse(firstPayload);
    expect(firstParsed.success).toBe(true);
    if (firstParsed.success && firstParsed.data.stage === "reviewer") {
      expect(firstParsed.data.payload.overallVerdict).toBe("changes_requested");
      expect(firstParsed.data.payload.findings.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected reviewer stage on first call");
    }

    const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const secondPayload = extractStructuredPayload(second.stdout);
    const secondParsed = CliOutputSchema.safeParse(secondPayload);
    expect(secondParsed.success).toBe(true);
    if (secondParsed.success && secondParsed.data.stage === "reviewer") {
      expect(secondParsed.data.payload.overallVerdict).toBe("approved");
    } else {
      throw new Error("expected reviewer stage on second call");
    }
  });

  it("keeps independent call counters per handler instance (new handler resets the sequence)", async () => {
    const handler1 = createMockProcessHandler();
    await handler1(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const handler2 = createMockProcessHandler();
    const result = await handler2(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.stage === "reviewer") {
      // A fresh handler's first code-review call is changes_requested again.
      expect(parsed.data.payload.overallVerdict).toBe("changes_requested");
    } else {
      throw new Error("expected reviewer stage");
    }
  });

  it("returns a failure payload for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "unknown-tool" }));
    const payload = extractStructuredPayload(result.stdout) as { success: boolean; stage: string };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
  });

  it("recognizes a command matched by basename (e.g. an absolute path ending in /codex)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/bin/codex", stdinData: "plan-reviewer handoff" }),
    );
    const payload = extractStructuredPayload(result.stdout);
    const parsed = CliOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.stage).toBe("plan-reviewer");
  });

  it("treats missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: undefined }));
    expect(() => extractStructuredPayload(result.stdout)).not.toThrow();
  });
});
