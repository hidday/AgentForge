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

  it("strips punctuation before extracting trigrams", () => {
    expect(extractTrigrams("a-b!c")).toEqual(extractTrigrams("abc"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty strings (both-empty branch)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs are too short to produce any trigram", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 0 when one side is empty but the other has trigrams (no shared overlap)", () => {
    expect(trigramSimilarity("", "hello world")).toBe(0);
    expect(trigramSimilarity("hello world", "")).toBe(0);
  });

  it("returns 1 for identical non-empty strings", () => {
    expect(trigramSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is symmetric", () => {
    expect(trigramSimilarity("hello world", "hello there")).toBe(
      trigramSimilarity("hello there", "hello world"),
    );
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "database migrations",
    skillMarkdown: "# Running database migrations\nUse prisma migrate deploy.",
  };

  it("scores against taskCategory and the first 200 chars of skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("factors in the skill name (hyphens normalized to spaces) when present", () => {
    const withName = { ...baseSkill, name: "database-migrations" };
    const score = scoreSkillRelevance(withName, "database migrations");
    expect(score).toBe(1);
  });

  it("factors in the description when present", () => {
    const withDescription = {
      ...baseSkill,
      taskCategory: "unrelated-zzz",
      skillMarkdown: "zzzzzzzzzzzzzzzzzzzzzz",
      description: "database migrations guide",
    };
    const score = scoreSkillRelevance(withDescription, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 when the query shares no trigrams with any field", () => {
    const score = scoreSkillRelevance(baseSkill, "qqqqqqq");
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skill list", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated", skillMarkdown: "nothing in common here at all" },
      { taskCategory: "database migrations", skillMarkdown: "database migrations guide" },
    ];
    expect(maxNoveltyOverlap(skills, "database migrations")).toBe(1);
  });
});
