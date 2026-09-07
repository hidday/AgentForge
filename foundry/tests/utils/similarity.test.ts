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

  it("strips punctuation before extracting", () => {
    expect(extractTrigrams("a-b!c")).toEqual(extractTrigrams("abc"));
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

  it("returns 0 for completely dissimilar strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("deploy to production", "deploy to staging");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when both strings are too short to produce any trigrams", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "authentication",
    skillMarkdown: "Use JWT tokens for stateless authentication across services.",
  };

  it("scores based on taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "authentication with JWT");
    expect(score).toBeGreaterThan(0);
  });

  it("considers the skill name (with dashes replaced by spaces) when present", () => {
    const skill = { ...baseSkill, name: "jwt-authentication-flow" };
    const score = scoreSkillRelevance(skill, "jwt authentication flow");
    const withoutName = scoreSkillRelevance(baseSkill, "jwt authentication flow");
    expect(score).toBeGreaterThanOrEqual(withoutName);
  });

  it("considers the skill description when present", () => {
    const skill = { ...baseSkill, description: "How to set up rate limiting for the API gateway" };
    const score = scoreSkillRelevance(skill, "rate limiting api gateway");
    const withoutDescription = scoreSkillRelevance(baseSkill, "rate limiting api gateway");
    expect(score).toBeGreaterThan(withoutDescription);
  });

  it("only uses the first 200 characters of skillMarkdown", () => {
    const longMarkdown = "x".repeat(500) + " unique-tail-content";
    const skill = { taskCategory: "irrelevant", skillMarkdown: longMarkdown };
    const score = scoreSkillRelevance(skill, "unique-tail-content");
    // The unique tail is beyond char 200, so it should not boost the score meaningfully.
    expect(score).toBeLessThan(0.5);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the highest relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "deployment", skillMarkdown: "Blue-green deploy strategy" },
      { taskCategory: "authentication", skillMarkdown: "JWT auth setup for services" },
    ];
    const overlap = maxNoveltyOverlap(skills, "JWT authentication setup");
    const authScore = scoreSkillRelevance(skills[1], "JWT authentication setup");
    expect(overlap).toBe(authScore);
  });
});
