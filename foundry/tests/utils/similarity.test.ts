import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("lowercases and strips punctuation before extracting trigrams", () => {
    const trigrams = extractTrigrams("Hi, World!");
    expect(trigrams.has("hi ")).toBe(true);
    expect(trigrams.has("wor")).toBe(true);
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are empty", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when one string is too short to produce trigrams but the other is not", () => {
    expect(trigramSimilarity("ab", "hello world")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "api validation", skillMarkdown: "Validate API requests with Zod." },
      "api validation",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes name and description in the scoring when present", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content",
        name: "api-validation",
        description: "api validation helper",
      },
      "api validation",
    );
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 when there are no existing skills", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the highest relevance score across all existing skills", () => {
    const score = maxNoveltyOverlap(
      [
        { taskCategory: "unrelated topic", skillMarkdown: "nothing in common" },
        { taskCategory: "api validation", skillMarkdown: "Validate API requests" },
      ],
      "api validation",
    );
    expect(score).toBeGreaterThan(0);
  });
});
