import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences from a lowercased string", () => {
    const trigrams = extractTrigrams("abcd");
    expect(trigrams).toEqual(new Set(["abc", "bcd"]));
  });

  it("lowercases input and strips punctuation before extracting", () => {
    const trigrams = extractTrigrams("A-B!C");
    // punctuation stripped -> "abc"
    expect(trigrams).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are empty", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when one string is empty (too short for trigrams) and the other is not", () => {
    expect(trigramSimilarity("", "hello world")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    const score = trigramSimilarity("aaa", "xyz xyz xyz");
    expect(score).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("uses only taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "auth-refactor", skillMarkdown: "Refactor the auth middleware safely" },
      "auth refactor",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("considers the name field (hyphens replaced with spaces) when present", () => {
    const withName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "completely different content here",
        name: "auth-refactor-guide",
      },
      "auth refactor guide",
    );
    const withoutName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "completely different content here",
      },
      "auth refactor guide",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("considers the description field when present", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "completely different content here",
        description: "How to refactor authentication safely",
      },
      "refactor authentication safely",
    );
    const withoutDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "completely different content here",
      },
      "refactor authentication safely",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });

  it("only considers the first 200 chars of skillMarkdown", () => {
    const longMarkdown = "x".repeat(300) + " relevant query terms here";
    const score = scoreSkillRelevance(
      { taskCategory: "cat", skillMarkdown: longMarkdown },
      "relevant query terms here",
    );
    // The matching text is beyond the first 200 chars, so it should not
    // contribute meaningfully via skillMarkdown; taskCategory match is weak too.
    expect(score).toBeLessThan(0.5);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated", skillMarkdown: "totally different content" },
      { taskCategory: "auth-refactor", skillMarkdown: "refactor auth middleware safely" },
    ];
    const score = maxNoveltyOverlap(skills, "refactor auth middleware safely");
    expect(score).toBeGreaterThan(0.5);
  });
});
