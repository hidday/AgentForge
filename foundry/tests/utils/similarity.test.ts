import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences, lowercased", () => {
    expect(extractTrigrams("Cats")).toEqual(new Set(["cat", "ats"]));
  });

  it("strips punctuation before extracting trigrams", () => {
    expect(extractTrigrams("a-b!c")).toEqual(extractTrigrams("abc"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty strings", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs are too short to produce any trigrams", () => {
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns 0 when only the left input is empty/too-short (right operand of the && short-circuits false)", () => {
    // trigramsA.size === 0 is true, trigramsB.size === 0 must be evaluated and is false.
    expect(trigramSimilarity("", "cats")).toBe(0);
  });

  it("returns 0 when only the right input is empty/too-short (left operand true short-circuits)", () => {
    expect(trigramSimilarity("cats", "")).toBe(0);
  });

  it("returns 1 for two identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially-overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abcdef", "xyz123")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "validation middleware", skillMarkdown: "Add Zod validation" },
      "validation middleware",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name (with dashes replaced by spaces) in the scored candidates", () => {
    const withName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally unrelated content here",
        name: "zod-validation-middleware",
      },
      "zod validation middleware",
    );
    const withoutName = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally unrelated content here",
      },
      "zod validation middleware",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("includes the description in the scored candidates", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally unrelated content here",
        description: "How to wire up Zod request validation middleware",
      },
      "Zod request validation middleware",
    );
    const withoutDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally unrelated content here",
      },
      "Zod request validation middleware",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });

  it("ignores a null name and null description", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "validation",
        skillMarkdown: "Add Zod validation",
        name: null,
        description: null,
      },
      "validation",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("only scores against the first 200 characters of skillMarkdown", () => {
    const longMarkdown = "z".repeat(300) + " unique-tail-phrase";
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: longMarkdown },
      "unique-tail-phrase",
    );
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existingSkills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const score = maxNoveltyOverlap(
      [
        { taskCategory: "totally unrelated", skillMarkdown: "nothing in common" },
        { taskCategory: "zod validation middleware", skillMarkdown: "Add Zod validation" },
      ],
      "zod validation middleware",
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(
      Math.max(
        scoreSkillRelevance(
          { taskCategory: "totally unrelated", skillMarkdown: "nothing in common" },
          "zod validation middleware",
        ),
        scoreSkillRelevance(
          { taskCategory: "zod validation middleware", skillMarkdown: "Add Zod validation" },
          "zod validation middleware",
        ),
      ),
    );
  });
});
