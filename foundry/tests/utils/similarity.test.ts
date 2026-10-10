import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character windows, lowercased", () => {
    expect(extractTrigrams("ABCD")).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting", () => {
    expect(extractTrigrams("a-b!c")).toEqual(extractTrigrams("abc"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty strings (both trigram sets empty)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs are shorter than 3 characters (both trigram sets empty)", () => {
    expect(trigramSimilarity("ab", "x")).toBe(0);
  });

  it("returns 0 when only one side has zero trigrams and there is no overlap", () => {
    // Left side empty (size 0), right side non-empty: exercises the false
    // branch of the `&&` guard without a shared early return.
    expect(trigramSimilarity("ab", "hello")).toBe(0);
    // Left side non-empty, right side empty.
    expect(trigramSimilarity("hello", "ab")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value in (0, 1) for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(trigramSimilarity("HELLO", "hello")).toBe(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "debounce search", skillMarkdown: "debounce search implementation" },
      "debounce search",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes name (with dashes replaced by spaces) when present", () => {
    const withName = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content",
        name: "debounce-search-skill",
      },
      "debounce search skill",
    );
    const withoutName = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content" },
      "debounce search skill",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("includes description when present", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content",
        description: "debounce search requests",
      },
      "debounce search requests",
    );
    const withoutDescription = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content" },
      "debounce search requests",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the max score across all existing skills", () => {
    const skills = [
      { taskCategory: "totally unrelated", skillMarkdown: "nothing matching here" },
      { taskCategory: "debounce search", skillMarkdown: "debounce search implementation" },
    ];
    const score = maxNoveltyOverlap(skills, "debounce search");
    expect(score).toBeGreaterThan(0);
  });
});
