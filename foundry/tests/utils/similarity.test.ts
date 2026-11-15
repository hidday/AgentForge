import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences from a lowercased, punctuation-stripped string", () => {
    const trigrams = extractTrigrams("abc!");
    expect(trigrams).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are shorter than 3 characters (both trigram sets empty)", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a partial score for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("abcdef", "ghijkl")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores higher when the query matches the skill name over the task category alone", () => {
    const skill = {
      taskCategory: "misc",
      skillMarkdown: "unrelated content here",
      name: "oauth2-setup",
      description: null,
    };
    const score = scoreSkillRelevance(skill, "oauth2 setup guide");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the description in the max when present", () => {
    const skill = {
      taskCategory: "misc",
      skillMarkdown: "unrelated",
      name: null,
      description: "How to configure JWT authentication",
    };
    const score = scoreSkillRelevance(skill, "configure JWT authentication");
    expect(score).toBeGreaterThan(0);
  });

  it("works when name and description are both absent", () => {
    const skill = { taskCategory: "auth", skillMarkdown: "Use JWT tokens." };
    expect(() => scoreSkillRelevance(skill, "JWT auth")).not.toThrow();
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skill list", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the highest score among several existing skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations" },
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth" },
    ];
    const score = maxNoveltyOverlap(skills, "add JWT auth middleware");
    const directScore = trigramSimilarity("add JWT auth middleware", "Use JWT tokens for auth");
    expect(score).toBeGreaterThanOrEqual(directScore - 0.001);
  });
});
