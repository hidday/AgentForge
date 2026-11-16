import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  CliOutputSchema,
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
import { IssueSchema } from "../../src/schemas/taskBundle.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractStructuredOutput(raw: string): unknown {
  const start = raw.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = raw.indexOf(STRUCTURED_OUTPUT_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const jsonText = raw.slice(start + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(jsonText);
}

describe("mockGitHubData", () => {
  describe("MOCK_DIFF", () => {
    it("is a syntactically plausible unified diff", () => {
      expect(MOCK_DIFF.startsWith("diff --git")).toBe(true);
      expect(MOCK_DIFF).toContain("@@");
      expect(MOCK_DIFF).toContain("--- ");
      expect(MOCK_DIFF).toContain("+++ ");
    });

    it("contains at least one hunk header with a valid @@ -l,s +l,s @@ shape", () => {
      const hunkHeaders = MOCK_DIFF.split("\n").filter((line) => line.startsWith("@@"));
      expect(hunkHeaders.length).toBeGreaterThan(0);
      for (const header of hunkHeaders) {
        expect(header).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
      }
    });

    it("has balanced diff --git headers for every file section", () => {
      const fileHeaders = MOCK_DIFF.split("\n").filter((line) => line.startsWith("diff --git"));
      // Every file section must have a matching --- / +++ pair.
      const minusLines = MOCK_DIFF.split("\n").filter((line) => line.startsWith("--- "));
      const plusLines = MOCK_DIFF.split("\n").filter((line) => line.startsWith("+++ "));
      expect(fileHeaders.length).toBeGreaterThan(0);
      expect(minusLines.length).toBe(fileHeaders.length);
      expect(plusLines.length).toBe(fileHeaders.length);
    });
  });

  describe("MOCK_REPO_CONFIG", () => {
    it("has a non-empty name and defaultBranch", () => {
      expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
      expect(MOCK_REPO_CONFIG.defaultBranch.length).toBeGreaterThan(0);
    });

    it("protects sensitive paths like .github/ and does not leave protectedPaths empty", () => {
      expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
      expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
    });

    it("allows the source and test paths that the diff actually touches", () => {
      expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
      expect(MOCK_REPO_CONFIG.allowedPaths).toContain("src/");
      expect(MOCK_REPO_CONFIG.allowedPaths).toContain("tests/");
    });

    it("does not allow any path that is also marked protected", () => {
      for (const protectedPath of MOCK_REPO_CONFIG.protectedPaths) {
        expect(MOCK_REPO_CONFIG.allowedPaths).not.toContain(protectedPath);
      }
    });
  });
});

describe("mockLinearData", () => {
  describe("MOCK_ISSUE", () => {
    it("has non-empty id and identifier strings", () => {
      expect(typeof MOCK_ISSUE.id).toBe("string");
      expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
      expect(typeof MOCK_ISSUE.identifier).toBe("string");
      expect(MOCK_ISSUE.identifier!.length).toBeGreaterThan(0);
    });

    it("has a priority within the valid 0-4 range used by IssueSchema", () => {
      expect(Number.isInteger(MOCK_ISSUE.priority)).toBe(true);
      expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
      expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
    });

    it("validates against the real IssueSchema used elsewhere in the codebase", () => {
      expect(() => IssueSchema.parse(MOCK_ISSUE)).not.toThrow();
    });

    it("has a state that matches one of the real Linear state strings used by linearSync", () => {
      expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
    });

    it("has a non-empty labels array of strings", () => {
      expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
      expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
      for (const label of MOCK_ISSUE.labels) {
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("MOCK_LINEAR_STATES", () => {
    it("matches the exact state labels used by linearSync's STATE_LABEL_MAP", () => {
      // Cross-checked against src/sync/linearSync.ts's STATE_LABEL_MAP issueState values.
      expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
      expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
      expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
      expect(MOCK_LINEAR_STATES.done).toBe("Done");
      expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
    });

    it("has no duplicate values and no empty strings", () => {
      const values = Object.values(MOCK_LINEAR_STATES);
      expect(new Set(values).size).toBe(values.length);
      for (const value of values) {
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("mockCliOutputs / createMockProcessHandler", () => {
  function spawnOptions(
    command: string,
    stdinData?: string,
  ): ProcessSpawnOptions {
    return { command, args: [], cwd: "/work", timeoutMs: 1000, stdinData };
  }

  it("returns a successful, non-timed-out ProcessResult shape for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("claude", "implementation plan for the issue"));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("returns planner output (validating against the real CliOutputSchema) for a claude planner prompt", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("claude", "You are the planner. Draft an implementation plan."));
    const parsedJson = extractStructuredOutput(result.stdout);
    const validated = CliOutputSchema.parse(parsedJson);
    expect(validated.success).toBe(true);
    expect(validated.stage).toBe("planner");
  });

  it("returns answer-researcher output for a claude prompt mentioning open questions to research", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      spawnOptions("/usr/local/bin/claude", "open questions to research before executing"),
    );
    const validated = CliOutputSchema.parse(extractStructuredOutput(result.stdout));
    expect(validated.stage).toBe("answer-researcher");
  });

  it("returns plan-reviser output for a claude prompt about plan revision", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("claude", "Perform a plan revision as lead engineer."));
    const validated = CliOutputSchema.parse(extractStructuredOutput(result.stdout));
    expect(validated.stage).toBe("plan-reviser");
  });

  it("returns remediation output for a claude prompt mentioning remediation", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("claude", "Please remediate the review findings."));
    const validated = CliOutputSchema.parse(extractStructuredOutput(result.stdout));
    expect(validated.stage).toBe("remediation");
  });

  it("falls back to executor output for a claude prompt that matches no other stage", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("claude", "implement the feature now"));
    const validated = CliOutputSchema.parse(extractStructuredOutput(result.stdout));
    expect(validated.stage).toBe("executor");
  });

  it("returns plan-reviewer output for a codex prompt about plan review", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("codex", "The plan under review needs a plan-reviewer pass."));
    const validated = CliOutputSchema.parse(extractStructuredOutput(result.stdout));
    expect(validated.stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(spawnOptions("codex", "review the implementation"));
    const firstValidated = CliOutputSchema.parse(extractStructuredOutput(first.stdout));
    expect(firstValidated.stage).toBe("reviewer");
    if (firstValidated.stage === "reviewer") {
      expect(firstValidated.payload.overallVerdict).toBe("changes_requested");
    }

    const second = await handler(spawnOptions("codex", "review the implementation again"));
    const secondValidated = CliOutputSchema.parse(extractStructuredOutput(second.stdout));
    expect(secondValidated.stage).toBe("reviewer");
    if (secondValidated.stage === "reviewer") {
      expect(secondValidated.payload.overallVerdict).toBe("approved");
    }
  });

  it("returns a failed, unparseable-payload output for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("some-other-cli"));
    const parsedJson = extractStructuredOutput(result.stdout) as { success: boolean; stage: string };
    expect(parsedJson.success).toBe(false);
    expect(parsedJson.stage).toBe("planner");
    // The payload is intentionally empty and must NOT satisfy the real planner schema,
    // confirming this branch is a deliberate "no valid output" simulation, not a real plan.
    expect(() => CliOutputSchema.parse(parsedJson)).toThrow();
  });

  it("treats stdinData case-insensitively when choosing which stage to simulate", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(spawnOptions("claude", "PLANNER: Implementation Plan Request"));
    const validated = CliOutputSchema.parse(extractStructuredOutput(result.stdout));
    expect(validated.stage).toBe("planner");
  });
});
