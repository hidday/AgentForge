import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

// Mirrors the LinearIssue interface (src/linear/linearClient.ts) so we can
// assert the mock satisfies that contract at runtime, not just at compile time.
const LinearIssueShape = z.object({
  id: z.string().min(1),
  identifier: z.string().optional(),
  title: z.string().min(1),
  description: z.string(),
  branchName: z.string().min(1),
  state: z.string().min(1),
  labels: z.array(z.string()),
  priority: z.number().int(),
  url: z.string().optional(),
  project: z.string().optional(),
  team: z.string().optional(),
  cycle: z.string().optional(),
});

describe("MOCK_ISSUE", () => {
  it("satisfies the LinearIssue shape", () => {
    expect(() => LinearIssueShape.parse(MOCK_ISSUE)).not.toThrow();
  });

  it("has a kebab-case-ish branch name derived from the identifier", () => {
    expect(MOCK_ISSUE.branchName).toMatch(/^mock\/lin-1042-/);
  });

  it("has a priority within Linear's 0-4 range", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("description contains the expected markdown sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("url points at the linear.app issue page for the identifier", () => {
    expect(MOCK_ISSUE.url).toContain("linear.app");
    expect(MOCK_ISSUE.url).toContain("LIN-1042");
  });

  it("labels is a non-empty array of strings", () => {
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    for (const label of MOCK_ISSUE.labels) {
      expect(typeof label).toBe("string");
    }
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines the standard Linear workflow states", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("MOCK_ISSUE.state is one of the known states", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
  });
});
