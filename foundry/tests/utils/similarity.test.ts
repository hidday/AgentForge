import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-char sequences, lowercased and punctuation-stripped", () => {
    expect(extractTrigrams("Add-Auth!")).toEqual(new Set(["add", "dda", "dau", "aut", "uth"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when one input is empty and the other is not (no overlap, non-zero union)", () => {
    expect(trigramSimilarity("", "auth middleware")).toBe(0);
    expect(trigramSimilarity("auth middleware", "")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("auth middleware", "auth middleware")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("auth middleware", "auth middlewhere");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT for auth." },
      "add auth middleware",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes name (hyphens replaced with spaces) and description in the max when present", () => {
    const withExtras = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "unrelated markdown content",
        name: "auth-middleware-jwt",
        description: "Use when adding auth middleware with JWT.",
      },
      "add auth middleware with jwt",
    );
    const withoutExtras = scoreSkillRelevance(
      { taskCategory: "unrelated-category", skillMarkdown: "unrelated markdown content" },
      "add auth middleware with jwt",
    );
    expect(withExtras).toBeGreaterThan(withoutExtras);
  });

  it("only slices the first 200 chars of skillMarkdown for scoring", () => {
    const longMarkdown = "z".repeat(500) + "auth middleware jwt tokens";
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: longMarkdown },
      "auth middleware jwt tokens",
    );
    // The matching text is past char 200, so it must not contribute to the score.
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "add auth middleware")).toBe(0);
  });

  it("returns the maximum relevance score across all skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations." },
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth middleware." },
    ];
    const overlap = maxNoveltyOverlap(skills, "add auth middleware with jwt");
    const directScore = scoreSkillRelevance(skills[1]!, "add auth middleware with jwt");
    expect(overlap).toBe(directScore);
  });
});
