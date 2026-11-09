import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character windows from a lowercased, punctuation-stripped string", () => {
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
    expect(extractTrigrams("ABCD")).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting", () => {
    expect(extractTrigrams("a-b-c")).toEqual(extractTrigrams("abc"));
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

  it("returns 0 when both strings are empty (or too short for trigrams)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 0 when one string is empty/too-short and the other is not", () => {
    expect(trigramSimilarity("", "hello")).toBe(0);
    expect(trigramSimilarity("ab", "hello")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("aaa", "zzz")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown", () => {
    const skill = { taskCategory: "database migration", skillMarkdown: "database migration steps" };
    const score = scoreSkillRelevance(skill, "database migration");
    expect(score).toBeGreaterThan(0.5);
  });

  it("also considers name (with dashes replaced by spaces) and description when present", () => {
    const skill = {
      taskCategory: "unrelated",
      skillMarkdown: "unrelated content here",
      name: "database-migration-helper",
      description: "Helps with database migrations",
    };
    const score = scoreSkillRelevance(skill, "database migration helper");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description scoring when they are absent", () => {
    const skill = { taskCategory: "testing", skillMarkdown: "testing content" };
    expect(() => scoreSkillRelevance(skill, "testing")).not.toThrow();
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated topic", skillMarkdown: "nothing relevant here" },
      { taskCategory: "database migration", skillMarkdown: "database migration steps" },
    ];
    const score = maxNoveltyOverlap(skills, "database migration");
    expect(score).toBeGreaterThan(0.5);
  });
});
