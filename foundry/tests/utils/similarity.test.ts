import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("lowercases and strips punctuation before extracting 3-char windows", () => {
    const trigrams = extractTrigrams("Hi, Bob!");
    expect(trigrams).toEqual(new Set(["hi ", "i b", " bo", "bob"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("hi")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("auth middleware", "auth middleware")).toBe(1);
  });

  it("returns 0 when both strings are too short to produce any trigrams", () => {
    expect(trigramSimilarity("a", "bb")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("add jwt authentication middleware", "jwt auth setup");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for strings with no shared trigrams", () => {
    expect(trigramSimilarity("xyz123", "qrstuv")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const skill = {
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens for authentication in middleware layers.",
  };

  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(skill, "auth middleware");
    expect(score).toBe(1);
  });

  it("includes the name (with hyphens replaced by spaces) when present", () => {
    const withName = { ...skill, name: "auth-middleware-jwt" };
    const score = scoreSkillRelevance(withName, "auth middleware jwt");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the description when present", () => {
    const withDescription = {
      ...skill,
      description: "Use when adding JWT-based auth middleware to an endpoint.",
    };
    const score = scoreSkillRelevance(withDescription, "JWT-based auth middleware");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description fields that are null", () => {
    const score = scoreSkillRelevance({ ...skill, name: null, description: null }, "auth middleware");
    expect(score).toBe(1);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the highest relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations in order." },
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth." },
    ];
    const overlap = maxNoveltyOverlap(skills, "add JWT auth middleware");
    const direct = trigramSimilarity("add JWT auth middleware", "auth middleware");
    expect(overlap).toBeGreaterThanOrEqual(direct);
  });
});
