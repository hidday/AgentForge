import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has required identifying fields consistent with each other", () => {
    expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.identifier).toBe(MOCK_ISSUE.id);
  });

  it("has a non-empty title and description", () => {
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
  });

  it("has a branchName that is git-safe (no spaces, lowercase, slug-like)", () => {
    expect(MOCK_ISSUE.branchName).toMatch(/^[a-z0-9/_-]+$/);
    expect(MOCK_ISSUE.branchName).not.toContain(" ");
  });

  it("has a state matching one of the documented MOCK_LINEAR_STATES values", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
  });

  it("has a non-empty labels array of strings", () => {
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.labels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
  });

  it("has a priority within the expected 0-4 Linear priority range", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("has a well-formed https URL pointing at the issue", () => {
    expect(() => new URL(MOCK_ISSUE.url!)).not.toThrow();
    expect(MOCK_ISSUE.url).toContain(MOCK_ISSUE.id);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("has distinct, non-empty values for every key", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(values.every((v) => typeof v === "string" && v.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it("includes the standard Linear workflow states", () => {
    expect(MOCK_LINEAR_STATES).toMatchObject({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
