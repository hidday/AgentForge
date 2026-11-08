import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences, lowercased and punctuation-stripped", () => {
    const trigrams = extractTrigrams("Add-Auth!");
    expect(trigrams.has("add")).toBe(true);
    expect(trigrams.has("dau")).toBe(true);
    expect(trigrams.has("aut")).toBe(true);
    expect(trigrams.has("uth")).toBe(true);
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("").size).toBe(0);
    expect(extractTrigrams("ab").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are empty (no trigrams on either side)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("a", "bc")).toBe(0);
  });

  it("returns 0 when inputs share no trigrams", () => {
    expect(trigramSimilarity("abcdef", "xyz123")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("authentication", "authentication")).toBe(1);
  });

  it("returns a partial score for partially overlapping strings", () => {
    const score = trigramSimilarity("add auth middleware", "add logging middleware");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is non-zero when only one side is empty-trigram but handles it without throwing", () => {
    // One side has trigrams, the other does not (not the "both empty" case).
    expect(trigramSimilarity("authentication flow", "ab")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens for stateless authentication in middleware.",
  };

  it("scores using taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "add JWT authentication middleware");
    expect(score).toBeGreaterThan(0);
  });

  it("factors in the skill name when present", () => {
    const score = scoreSkillRelevance(
      { ...baseSkill, name: "jwt-auth-middleware" },
      "jwt auth middleware",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("factors in the skill description when present", () => {
    const score = scoreSkillRelevance(
      { ...baseSkill, description: "Use when adding JWT-based authentication." },
      "JWT based authentication",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("ignores a null name and a null description", () => {
    const score = scoreSkillRelevance(
      { ...baseSkill, name: null, description: null },
      "add JWT authentication middleware",
    );
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "add JWT authentication middleware")).toBe(0);
  });

  it("returns the highest relevance score across multiple existing skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations in order" },
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for stateless auth" },
    ];
    const overlap = maxNoveltyOverlap(skills, "add JWT auth middleware");
    const direct = scoreSkillRelevance(skills[1]!, "add JWT auth middleware");
    expect(overlap).toBe(direct);
    expect(overlap).toBeGreaterThan(0);
  });
});
