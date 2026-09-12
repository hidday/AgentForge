import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-char windows, lowercased", () => {
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
  it("returns 0 when both inputs are empty strings", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs normalize to nothing (punctuation only)", () => {
    expect(trigramSimilarity("!!!", "??")).toBe(0);
  });

  it("returns 0 when one side is empty/too-short and the other is not (no overlap)", () => {
    expect(trigramSimilarity("", "hello world")).toBe(0);
    expect(trigramSimilarity("ab", "hello world")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "database migrations",
    skillMarkdown: "# How to write a safe database migration\nAlways add an index concurrently.",
  };

  it("scores against taskCategory and the first 200 chars of skillMarkdown when name/description absent", () => {
    const score = scoreSkillRelevance(baseSkill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name field (with dashes replaced by spaces) in the scoring set when present", () => {
    const withName = { ...baseSkill, name: "database-migrations-guide" };
    const score = scoreSkillRelevance(withName, "database migrations guide");
    const withoutName = scoreSkillRelevance(baseSkill, "database migrations guide");
    expect(score).toBeGreaterThanOrEqual(withoutName);
  });

  it("includes the description field in the scoring set when present", () => {
    const withDescription = {
      ...baseSkill,
      description: "A guide for writing zero-downtime database migrations",
    };
    const score = scoreSkillRelevance(
      withDescription,
      "zero-downtime database migrations",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description when they are null", () => {
    const skill = { ...baseSkill, name: null, description: null };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated topic entirely", skillMarkdown: "nothing in common here" },
      { taskCategory: "database migrations", skillMarkdown: "database migration guide" },
    ];
    const score = maxNoveltyOverlap(skills, "database migrations");
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(
      Math.max(
        ...skills.map((s) =>
          Math.max(
            trigramSimilarity("database migrations", s.taskCategory),
            trigramSimilarity("database migrations", s.skillMarkdown.slice(0, 200)),
          ),
        ),
      ),
    );
  });
});
