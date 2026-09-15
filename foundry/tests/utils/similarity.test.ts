import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping trigrams from a normal string", () => {
    const trigrams = extractTrigrams("abcd");
    expect(trigrams).toEqual(new Set(["abc", "bcd"]));
  });

  it("lowercases and strips punctuation", () => {
    const trigrams = extractTrigrams("A-B.C!");
    expect(trigrams).toEqual(extractTrigrams("abc"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are empty", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both strings are too short to form trigrams (union 0 branch)", () => {
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("abcdef", "ghijkl")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "database migrations",
    skillMarkdown: "This skill helps write safe database migration scripts.",
  };

  it("scores using taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name (with dashes replaced by spaces) when present", () => {
    const skill = { ...baseSkill, name: "database-migrations" };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBe(1);
  });

  it("includes the description when present", () => {
    const skill = {
      ...baseSkill,
      description: "exact match description text",
    };
    const score = scoreSkillRelevance(skill, "exact match description text");
    expect(score).toBe(1);
  });

  it("ignores name/description when null", () => {
    const skill = { ...baseSkill, name: null, description: null };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all skills", () => {
    const skills = [
      { taskCategory: "unrelated topic", skillMarkdown: "totally different content here" },
      { taskCategory: "database migrations", skillMarkdown: "write safe migration scripts" },
    ];
    const score = maxNoveltyOverlap(skills, "database migrations");
    const expected = Math.max(...skills.map((s) => scoreSkillRelevance(s, "database migrations")));
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(expected);
    expect(score).toBe(scoreSkillRelevance(skills[1]!, "database migrations"));
  });
});
