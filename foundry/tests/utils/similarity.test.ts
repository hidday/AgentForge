import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping lowercase trigrams, stripping punctuation", () => {
    const trigrams = extractTrigrams("Hi, world!");
    // "hi, world!" -> strip punctuation -> "hi world" -> trigrams
    expect(trigrams.has("hi ")).toBe(true);
    expect(trigrams.has("wor")).toBe(true);
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are empty (both trigram sets empty)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both strings are too short to produce trigrams", () => {
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns 0 when one string is empty and the other is not (asymmetric empty set)", () => {
    expect(trigramSimilarity("", "hello world")).toBe(0);
    expect(trigramSimilarity("hello world", "")).toBe(0);
  });

  it("returns 1 for identical non-empty strings (full overlap, union === intersection)", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    const score = trigramSimilarity("abc def", "xyz uvw");
    expect(score).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown, taking the max", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "database migrations", skillMarkdown: "Some unrelated markdown content." },
      "database migrations",
    );
    expect(score).toBe(1);
  });

  it("includes the optional name (with dashes replaced by spaces) in the max when present", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "zzz",
        skillMarkdown: "zzz",
        name: "database-migrations",
      },
      "database migrations",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes the optional description in the max when present", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "zzz",
        skillMarkdown: "zzz",
        description: "Handles database migrations end to end.",
      },
      "database migrations",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description scoring when they are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated" },
      "database migrations",
    );
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existingSkills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const existingSkills = [
      { taskCategory: "unrelated topic", skillMarkdown: "nothing in common here" },
      { taskCategory: "database migrations", skillMarkdown: "database migrations guide" },
    ];
    const score = maxNoveltyOverlap(existingSkills, "database migrations");
    expect(score).toBe(1);
  });
});
