import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

// There is no existing dedicated test file for similarity.ts (it is only
// exercised indirectly through agent tests), so this is a full test file
// rather than a narrow gap-only one. It covers normal behavior plus the
// boundary/branch cases the indirect coverage misses: empty-string inputs,
// the both-empty-sets zero case, the optional `name`/`description` fields on
// scoreSkillRelevance, and the empty-array case for maxNoveltyOverlap.

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character windows after lowercasing", () => {
    expect(extractTrigrams("ABC")).toEqual(new Set(["abc"]));
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting trigrams", () => {
    // "a-b!c" -> "abc" after stripping non-word, non-space characters.
    expect(extractTrigrams("a-b!c")).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });

  it("deduplicates repeated trigrams", () => {
    expect(extractTrigrams("aaaa")).toEqual(new Set(["aaa"]));
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical non-empty strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("abcdef", "ghijkl")).toBe(0);
  });

  it("returns 0 when both strings are empty (both trigram sets empty)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both strings are shorter than 3 characters (both trigram sets empty)", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 0 when one side is empty but the other is not (union > 0, no intersection)", () => {
    expect(trigramSimilarity("", "hello")).toBe(0);
    expect(trigramSimilarity("hello", "")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially-overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is symmetric", () => {
    const a = "the quick brown fox";
    const b = "the quick brown dog";
    expect(trigramSimilarity(a, b)).toBeCloseTo(trigramSimilarity(b, a));
  });
});

describe("scoreSkillRelevance", () => {
  it("returns the max of taskCategory and skillMarkdown[0:200] similarity when name/description are absent", () => {
    const skill = {
      taskCategory: "database migrations",
      skillMarkdown: "This skill helps with database migrations and schema changes.",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
    // Exact match against taskCategory should dominate (score 1).
    expect(score).toBe(1);
  });

  it("only compares the first 200 characters of skillMarkdown", () => {
    const longTail = "x".repeat(10_000) + "database migrations";
    const skill = {
      taskCategory: "unrelated",
      skillMarkdown: longTail,
    };
    // The matching text is far past the 200-char cutoff, so it should not
    // contribute to the score at all; taskCategory similarity to "database
    // migrations" also scores low, so the overall score should stay low.
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeLessThan(0.2);
  });

  it("includes name (with dashes replaced by spaces) in the max when name is present", () => {
    const skill = {
      taskCategory: "unrelated-category",
      skillMarkdown: "unrelated markdown content that does not match at all",
      name: "database-migrations",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBe(1);
  });

  it("includes description in the max when description is present", () => {
    const skill = {
      taskCategory: "unrelated-category",
      skillMarkdown: "unrelated markdown content that does not match at all",
      description: "database migrations",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBe(1);
  });

  it("ignores name when it is null or an empty string", () => {
    const base = {
      taskCategory: "zzz",
      skillMarkdown: "zzz",
    };
    const withNullName = scoreSkillRelevance({ ...base, name: null }, "database migrations");
    const withEmptyName = scoreSkillRelevance({ ...base, name: "" }, "database migrations");
    const withoutName = scoreSkillRelevance(base, "database migrations");
    expect(withNullName).toBe(withoutName);
    expect(withEmptyName).toBe(withoutName);
  });

  it("ignores description when it is null or an empty string", () => {
    const base = {
      taskCategory: "zzz",
      skillMarkdown: "zzz",
    };
    const withNullDescription = scoreSkillRelevance(
      { ...base, description: null },
      "database migrations",
    );
    const withEmptyDescription = scoreSkillRelevance(
      { ...base, description: "" },
      "database migrations",
    );
    const withoutDescription = scoreSkillRelevance(base, "database migrations");
    expect(withNullDescription).toBe(withoutDescription);
    expect(withEmptyDescription).toBe(withoutDescription);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existingSkills array", () => {
    expect(maxNoveltyOverlap([], "database migrations")).toBe(0);
  });

  it("returns the maximum scoreSkillRelevance across all existing skills", () => {
    const existingSkills = [
      { taskCategory: "unrelated-one", skillMarkdown: "nothing in common here" },
      { taskCategory: "database migrations", skillMarkdown: "a perfect match" },
      { taskCategory: "unrelated-two", skillMarkdown: "also nothing in common" },
    ];
    expect(maxNoveltyOverlap(existingSkills, "database migrations")).toBe(1);
  });

  it("returns a low score when no existing skill is relevant", () => {
    const existingSkills = [
      { taskCategory: "completely-unrelated-topic", skillMarkdown: "nothing matches" },
    ];
    const score = maxNoveltyOverlap(existingSkills, "database migrations");
    expect(score).toBeLessThan(0.5);
  });
});
