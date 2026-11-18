import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping lowercase trigrams and strips punctuation", () => {
    const trigrams = extractTrigrams("Ab-C!");
    // normalized -> "abc" (punctuation stripped, lowercased)
    expect(trigrams).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("")).toEqual(new Set());
    expect(extractTrigrams("ab")).toEqual(new Set());
  });

  it("preserves internal whitespace when extracting trigrams", () => {
    const trigrams = extractTrigrams("a b");
    expect(trigrams.has("a b")).toBe(true);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are empty/too short", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when only one side is empty (no shared trigrams, non-zero union)", () => {
    expect(trigramSimilarity("", "hello")).toBe(0);
    expect(trigramSimilarity("hello", "")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "authentication flows",
    skillMarkdown: "## Auth\n\nUse OAuth2 for all new integrations.",
  };

  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "authentication flows");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name (with hyphens replaced by spaces) when present", () => {
    const withName = { ...baseSkill, name: "auth-flows" };
    const score = scoreSkillRelevance(withName, "auth flows");
    const withoutName = scoreSkillRelevance(baseSkill, "auth flows");
    expect(score).toBeGreaterThanOrEqual(withoutName);
  });

  it("includes the description when present", () => {
    const withDescription = {
      ...baseSkill,
      description: "A guide for wiring OAuth2 into new services",
    };
    const score = scoreSkillRelevance(withDescription, "wiring OAuth2 into new services");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description when they are null", () => {
    const skill = { ...baseSkill, name: null, description: null };
    const score = scoreSkillRelevance(skill, "authentication flows");
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty list of existing skills", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all existing skills", () => {
    const unrelated = { taskCategory: "totally unrelated topic", skillMarkdown: "nothing in common here" };
    const related = { taskCategory: "database migrations", skillMarkdown: "## Migrations\n\nUse Prisma migrate." };

    const query = "database migrations";
    const expected = Math.max(
      scoreSkillRelevance(unrelated, query),
      scoreSkillRelevance(related, query),
    );

    expect(maxNoveltyOverlap([unrelated, related], query)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});
