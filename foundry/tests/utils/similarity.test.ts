import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-char sequences, lowercased and punctuation-stripped", () => {
    const trigrams = extractTrigrams("Ab-C!");
    // "Ab-C!" -> normalized "abc" -> one trigram.
    expect(trigrams).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty (no trigrams on either side)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("ab", "x")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("debounce loading search", "debounce search results");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "api-validation", skillMarkdown: "Add Zod validation middleware" },
      "api validation",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name (with hyphens replaced by spaces) in the max when provided", () => {
    const withName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally different content that does not overlap at all",
        name: "api-validation-middleware",
      },
      "api validation middleware",
    );
    const withoutName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally different content that does not overlap at all",
      },
      "api validation middleware",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("includes the description in the max when provided", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally different content that does not overlap at all",
        description: "api validation middleware for all endpoints",
      },
      "api validation middleware",
    );
    const withoutDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally different content that does not overlap at all",
      },
      "api validation middleware",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty list of existing skills", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "totally-unrelated", skillMarkdown: "nothing in common whatsoever" },
      { taskCategory: "api-validation", skillMarkdown: "api validation using zod schemas" },
    ];
    const score = maxNoveltyOverlap(skills, "api validation using zod schemas");
    expect(score).toBeGreaterThan(0);
    // Should match the second (highly relevant) skill, not the first.
    const soloScore = scoreSkillRelevance(skills[1], "api validation using zod schemas");
    expect(score).toBe(soloScore);
  });
});
