import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences, lowercased", () => {
    expect(extractTrigrams("ABCD")).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting trigrams", () => {
    expect(extractTrigrams("a-b,c!d")).toEqual(extractTrigrams("abcd"));
  });

  it("returns an empty set for input shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
  });

  it("returns an empty set for an empty string", () => {
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty (boundary: both trigram sets empty)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs normalize to fewer than 3 characters", () => {
    expect(trigramSimilarity("ab", "!!")).toBe(0);
  });

  it("returns 1 for identical non-empty strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("aaa", "zzz")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partial overlap", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when only one side is empty", () => {
    expect(trigramSimilarity("", "non-empty text")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "database migrations",
    skillMarkdown: "How to safely run database migrations in production environments.",
  };

  it("scores using taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name field (with dashes replaced by spaces) in the scoring", () => {
    const skill = { ...baseSkill, name: "database-migrations-guide" };
    const score = scoreSkillRelevance(skill, "database migrations guide");
    const withoutName = scoreSkillRelevance(baseSkill, "database migrations guide");
    expect(score).toBeGreaterThanOrEqual(withoutName);
  });

  it("includes the description field in the scoring", () => {
    const skill = { ...baseSkill, description: "zero downtime schema changes" };
    const score = scoreSkillRelevance(skill, "zero downtime schema changes");
    const withoutDescription = scoreSkillRelevance(baseSkill, "zero downtime schema changes");
    expect(score).toBeGreaterThanOrEqual(withoutDescription);
  });

  it("ignores a null name and null description", () => {
    const skill = { ...baseSkill, name: null, description: null };
    expect(() => scoreSkillRelevance(skill, "database migrations")).not.toThrow();
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated topic", skillMarkdown: "totally different content here" },
      { taskCategory: "database migrations", skillMarkdown: "database migrations guide" },
    ];
    const score = maxNoveltyOverlap(skills, "database migrations");
    expect(score).toBe(scoreSkillRelevance(skills[1], "database migrations"));
  });
});
