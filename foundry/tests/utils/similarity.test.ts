import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences from a lowercase string", () => {
    const trigrams = extractTrigrams("abcd");
    expect(trigrams).toEqual(new Set(["abc", "bcd"]));
  });

  it("lowercases the input before extracting", () => {
    const trigrams = extractTrigrams("ABCD");
    expect(trigrams).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting", () => {
    const trigrams = extractTrigrams("a-b.c!d");
    expect(trigrams).toEqual(extractTrigrams("abcd"));
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });

  it("deduplicates repeated trigrams", () => {
    const trigrams = extractTrigrams("aaaa");
    expect(trigrams).toEqual(new Set(["aaa"]));
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for two identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for two completely disjoint strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns 0 when both inputs are empty strings", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs are shorter than 3 chars (both trigram sets empty)", () => {
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns 0 when only one side is empty (skips the both-empty short-circuit, hits a non-zero union)", () => {
    const score = trigramSimilarity("", "a longer string with trigrams");
    expect(score).toBe(0);
  });

  it("returns a partial score for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "api-validation", skillMarkdown: "## Validation steps for API endpoints" },
      "api validation",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes the skill name (with hyphens replaced by spaces) when present", () => {
    const withName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "unrelated markdown content",
        name: "api-validation-middleware",
      },
      "api validation middleware",
    );
    const withoutName = scoreSkillRelevance(
      { taskCategory: "unrelated-category", skillMarkdown: "unrelated markdown content" },
      "api validation middleware",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("includes the skill description when present", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "unrelated markdown content",
        description: "api validation middleware for fastify routes",
      },
      "api validation middleware",
    );
    const withoutDescription = scoreSkillRelevance(
      { taskCategory: "unrelated-category", skillMarkdown: "unrelated markdown content" },
      "api validation middleware",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });

  it("ignores a null name and null description", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "api-validation",
        skillMarkdown: "validation steps",
        name: null,
        description: null,
      },
      "api validation",
    );
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("truncates skillMarkdown comparison to the first 200 characters", () => {
    const longMarkdown = "x".repeat(300) + "unique-tail-content";
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: longMarkdown },
      "unique-tail-content",
    );
    // The matching text lives beyond the 200-char cutoff, so it should not
    // contribute meaningfully to the score (score stays low/zero).
    expect(score).toBeLessThan(0.5);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the max relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated-topic", skillMarkdown: "nothing in common here" },
      { taskCategory: "api validation", skillMarkdown: "api validation for endpoints" },
    ];
    const score = maxNoveltyOverlap(skills, "api validation");
    const directScore = scoreSkillRelevance(skills[1], "api validation");
    expect(score).toBe(directScore);
  });
});
