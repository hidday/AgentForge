import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences, lowercased", () => {
    const trigrams = extractTrigrams("ABCD");
    expect(trigrams).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting", () => {
    const trigrams = extractTrigrams("a-b,c!d");
    expect(trigrams).toEqual(extractTrigrams("abcd"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("add request validation", "add response validation");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely dissimilar strings", () => {
    expect(trigramSimilarity("xyz123", "qqqqqq")).toBe(0);
  });

  it("returns 0 when both strings normalize to empty trigram sets (both under 3 chars)", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown", () => {
    const skill = {
      taskCategory: "add request validation middleware",
      skillMarkdown: "# Add request validation middleware\nUse Zod schemas.",
    };
    const score = scoreSkillRelevance(skill, "add request validation middleware");
    expect(score).toBeGreaterThan(0.5);
  });

  it("includes name (hyphens replaced with spaces) in the max when present", () => {
    const skill = {
      taskCategory: "unrelated category",
      skillMarkdown: "unrelated markdown content that does not match at all",
      name: "add-request-validation",
    };
    const score = scoreSkillRelevance(skill, "add request validation");
    expect(score).toBeGreaterThan(0);
  });

  it("includes description in the max when present", () => {
    const skill = {
      taskCategory: "zzz",
      skillMarkdown: "zzz",
      description: "Add request validation to endpoints",
    };
    const score = scoreSkillRelevance(skill, "add request validation to endpoints");
    expect(score).toBeGreaterThan(0.5);
  });

  it("ignores name/description scoring when they are absent or null", () => {
    const skill = {
      taskCategory: "some category",
      skillMarkdown: "some markdown",
      name: null,
      description: null,
    };
    const score = scoreSkillRelevance(skill, "some category");
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "totally unrelated topic", skillMarkdown: "nothing in common" },
      { taskCategory: "add request validation", skillMarkdown: "add request validation details" },
    ];
    const overlap = maxNoveltyOverlap(skills, "add request validation");
    expect(overlap).toBeGreaterThan(0.5);
  });
});
