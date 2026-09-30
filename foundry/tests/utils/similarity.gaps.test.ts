import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("").size).toBe(0);
    expect(extractTrigrams("ab").size).toBe(0);
  });

  it("extracts overlapping trigrams and lowercases/strips punctuation", () => {
    const trigrams = extractTrigrams("Ab!");
    expect(trigrams.size).toBe(0); // "ab" is only 2 chars after stripping "!", too short for a trigram

    const longer = extractTrigrams("Hi There!");
    // normalizes to "hi there" (lowercased, "!" stripped, space kept)
    expect(longer.has("hi ")).toBe(true);
    expect(longer.has("the")).toBe(true);
    expect(longer.has("her")).toBe(true);
    expect(longer.has("ere")).toBe(true);
  });
});

describe("trigramSimilarity -- boundary conditions (gap coverage)", () => {
  it("returns 0 when both strings are empty", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when one string is empty and the other is not (empty has no trigrams)", () => {
    expect(trigramSimilarity("", "hello world")).toBe(0);
    expect(trigramSimilarity("hello world", "")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely different strings with no shared trigrams", () => {
    expect(trigramSimilarity("aaa", "zzz")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is symmetric", () => {
    const a = "the quick brown fox";
    const b = "the quick brown dog";
    expect(trigramSimilarity(a, b)).toBeCloseTo(trigramSimilarity(b, a), 10);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "networking retries", skillMarkdown: "Use exponential backoff for retries" },
      "networking retries",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes name (hyphens replaced with spaces) and description in the scored candidates", () => {
    const withExtras = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "completely unrelated markdown content here",
        name: "retry-with-backoff",
        description: "retry with backoff strategy",
      },
      "retry with backoff",
    );
    const withoutExtras = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "completely unrelated markdown content here",
      },
      "retry with backoff",
    );
    expect(withExtras).toBeGreaterThan(withoutExtras);
  });

  it("returns 0 when nothing overlaps at all", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "aaa", skillMarkdown: "bbb" },
      "zzz",
    );
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the max relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated", skillMarkdown: "nothing in common" },
      { taskCategory: "networking retries", skillMarkdown: "retry logic with backoff" },
    ];
    const score = maxNoveltyOverlap(skills, "networking retries");
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(
      Math.max(
        ...skills.map((s) =>
          Math.max(
            trigramSimilarity("networking retries", s.taskCategory),
            trigramSimilarity("networking retries", s.skillMarkdown.slice(0, 200)),
          ),
        ),
      ),
    );
  });
});
