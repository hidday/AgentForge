import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping lowercase trigrams and strips punctuation", () => {
    const trigrams = extractTrigrams("Hi, World!");
    // "Hi, World!" -> normalized "hi world" -> trigrams: "hi ","i w"," wo","wor","orl","rld"
    expect(trigrams.has("hi ")).toBe(true);
    expect(trigrams.has("wor")).toBe(true);
    expect(trigrams.has("rld")).toBe(true);
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
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

  it("returns 0 when both inputs normalize to empty trigram sets", () => {
    // Both strings are under 3 characters after normalization, so both
    // trigram sets are empty -- exercises the `size===0 && size===0` guard.
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("ab", "!!")).toBe(0);
  });

  it("returns a low but non-negative score for completely disjoint text", () => {
    const score = trigramSimilarity("abcdefgh", "zzzzzzzz");
    expect(score).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown, taking the max", () => {
    const skill = {
      taskCategory: "database migrations",
      skillMarkdown: "This skill helps with database migrations and schema changes.",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0.5);
  });

  it("also considers name and description when present", () => {
    const skill = {
      taskCategory: "unrelated",
      skillMarkdown: "unrelated content here",
      name: "database-migrations",
      description: "Handles database migrations end to end",
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description when they are null", () => {
    const skill = {
      taskCategory: "database migrations",
      skillMarkdown: "database migrations",
      name: null,
      description: null,
    };
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty list of existing skills", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the highest relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "totally unrelated topic", skillMarkdown: "nothing in common" },
      { taskCategory: "database migrations", skillMarkdown: "database migrations guide" },
    ];
    const score = maxNoveltyOverlap(skills, "database migrations");
    expect(score).toBeGreaterThan(0.5);
  });
});
