import { describe, it, expect } from "vitest";
import { extractTrigrams, trigramSimilarity, scoreSkillRelevance } from "../../src/utils/similarity.js";

describe("trigramSimilarity — empty-set branch coverage", () => {
  it("returns 0 when both strings are too short to produce any trigrams", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("computes a similarity score when only one side has trigrams (no early return)", () => {
    // "ab" has zero trigrams (extractTrigrams requires length >= 3), while
    // "abcdef" has several — this exercises the false branch of the
    // `trigramsA.size === 0 && trigramsB.size === 0` guard.
    const score = trigramSimilarity("ab", "abcdef");
    expect(score).toBe(0);
  });

  it("computes a nonzero similarity for two overlapping non-empty strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns 1 for two identical non-empty strings", () => {
    expect(trigramSimilarity("identical text", "identical text")).toBe(1);
  });
});

describe("extractTrigrams", () => {
  it("lowercases and strips punctuation before extracting", () => {
    const trigrams = extractTrigrams("Hi, World!");
    expect(trigrams.has("wor")).toBe(true);
    // Punctuation is stripped before extraction: "Hi, World!" normalizes to
    // "hi world", so no trigram should contain a comma or exclamation mark.
    expect([...trigrams].some((t) => t.includes(",") || t.includes("!"))).toBe(false);
    expect([...trigrams].every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("scoreSkillRelevance — optional name/description branches", () => {
  it("considers skill.name when present", () => {
    const withName = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content here", name: "jwt auth setup" },
      "jwt auth setup",
    );
    const withoutName = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content here" },
      "jwt auth setup",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("considers skill.description when present", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content here",
        description: "rate limiting with redis buckets",
      },
      "rate limiting with redis buckets",
    );
    const withoutDescription = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content here" },
      "rate limiting with redis buckets",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });
});
