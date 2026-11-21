import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("lowercases, strips punctuation and returns overlapping 3-grams", () => {
    expect([...extractTrigrams("Ab,cD!")]).toEqual(["abc", "bcd"]);
  });

  it("returns an empty set for strings shorter than 3 chars after normalisation", () => {
    expect(extractTrigrams("").size).toBe(0);
    expect(extractTrigrams("a!b").size).toBe(0);
  });

  it("deduplicates repeated trigrams", () => {
    expect([...extractTrigrams("aaaa")]).toEqual(["aaa"]);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs have no trigrams", () => {
    expect(trigramSimilarity("", "ab")).toBe(0);
  });

  it("returns 0 when exactly one side has no trigrams", () => {
    expect(trigramSimilarity("", "abcdef")).toBe(0);
    expect(trigramSimilarity("abcdef", "x")).toBe(0);
  });

  it("returns 1 for identical text (case/punctuation-insensitive)", () => {
    expect(trigramSimilarity("Hello, World", "hello world")).toBe(1);
  });

  it("computes the Jaccard coefficient", () => {
    // "abcd" → {abc,bcd}; "bcde" → {bcd,cde}; intersection 1, union 3
    expect(trigramSimilarity("abcd", "bcde")).toBeCloseTo(1 / 3, 10);
  });
});

describe("scoreSkillRelevance", () => {
  const base = { taskCategory: "zzzzzz", skillMarkdown: "yyyyyy" };

  it("takes the max across category and markdown", () => {
    expect(scoreSkillRelevance({ ...base, taskCategory: "auth middleware" }, "auth middleware")).toBe(1);
  });

  it("only considers the first 200 chars of markdown", () => {
    const skill = { ...base, skillMarkdown: "q".repeat(200) + "redis cache" };
    expect(scoreSkillRelevance(skill, "redis cache")).toBe(0);
  });

  it("considers the name with dashes replaced by spaces, and the description", () => {
    expect(scoreSkillRelevance({ ...base, name: "redis-cache" }, "redis cache")).toBe(1);
    expect(scoreSkillRelevance({ ...base, description: "redis cache" }, "redis cache")).toBe(1);
  });

  it("ignores null name/description", () => {
    expect(scoreSkillRelevance({ ...base, name: null, description: null }, "redis cache")).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skill pool", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the highest relevance across skills", () => {
    const skills = [
      { taskCategory: "unrelated", skillMarkdown: "nothing" },
      { taskCategory: "abcd", skillMarkdown: "x" },
      { taskCategory: "abce", skillMarkdown: "x" },
    ];
    expect(maxNoveltyOverlap(skills, "abcd")).toBe(1);
  });
});
