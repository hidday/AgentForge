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
    expect(extractTrigrams("a-b!c")).toEqual(extractTrigrams("abc"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when both inputs are too short to produce trigrams", () => {
    // Both sets empty hits the explicit "both empty" early return (not the
    // union === 0 guard, which is unreachable once that early return exists).
    expect(trigramSimilarity("ab", "cd")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when only one input is too short to produce trigrams (no overlap)", () => {
    expect(trigramSimilarity("ab", "hello world")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(trigramSimilarity("HELLO", "hello")).toBe(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("returns the max similarity across taskCategory and skillMarkdown", () => {
    const skill = {
      taskCategory: "database migrations",
      skillMarkdown: "# Totally unrelated content about rendering UI",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBe(1);
  });

  it("includes name in scoring when present", () => {
    const skill = {
      taskCategory: "unrelated",
      skillMarkdown: "unrelated content",
      name: "database-migrations",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("includes description in scoring when present", () => {
    const skill = {
      taskCategory: "unrelated",
      skillMarkdown: "unrelated content",
      description: "Handles database migrations end to end.",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores null name and description", () => {
    const skill = {
      taskCategory: "database migrations",
      skillMarkdown: "unrelated",
      name: null,
      description: null,
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBe(1);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "database migrations")).toBe(0);
  });

  it("returns the max relevance score across all skills", () => {
    const skills = [
      { taskCategory: "unrelated topic", skillMarkdown: "nothing in common" },
      { taskCategory: "database migrations", skillMarkdown: "database migrations" },
    ];
    expect(maxNoveltyOverlap(skills, "database migrations")).toBe(1);
  });
});
