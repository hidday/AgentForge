import { describe, it, expect } from "vitest";
import { extractTrigrams, trigramSimilarity, scoreSkillRelevance, maxNoveltyOverlap } from "../../src/utils/similarity.js";

// No dedicated test file previously existed for similarity.ts (it was only
// exercised indirectly through distillationAgent tests). This fills that gap
// directly, including the trigramSimilarity "both sets empty" short-circuit.
//
// Note: the second guard inside trigramSimilarity, `if (union === 0) return
// 0;`, is dead code. `union = trigramsA.size + trigramsB.size - intersection`
// can only be 0 when both operand sizes are 0 (intersection is bounded by
// min(sizeA, sizeB), so a 0 union with either size > 0 is impossible) -- and
// that exact case is already caught by the earlier
// `trigramsA.size === 0 && trigramsB.size === 0` check, which returns before
// ever computing `union`. See the final test-run summary for the proposed
// vitest.config.ts coverage-exclusion comment.

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character windows, lowercased and punctuation-stripped", () => {
    expect(extractTrigrams("Cat!")).toEqual(new Set(["cat"]));
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("")).toEqual(new Set());
    expect(extractTrigrams("ab")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are too short to produce any trigrams", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("auth middleware", "auth middleware")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("xyz123", "qqq999")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially-overlapping strings", () => {
    const score = trigramSimilarity("add jwt auth middleware", "jwt token authentication");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown, taking the max", () => {
    const skill = { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth." };
    const score = scoreSkillRelevance(skill, "add jwt auth middleware");
    expect(score).toBeGreaterThan(0);
  });

  it("also considers name and description when present", () => {
    const withExtras = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "totally unrelated body",
        name: "auth-middleware",
        description: "Use when adding auth middleware",
      },
      "add auth middleware",
    );
    const withoutExtras = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "totally unrelated body" },
      "add auth middleware",
    );
    expect(withExtras).toBeGreaterThan(withoutExtras);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skill pool", () => {
    expect(maxNoveltyOverlap([], "add auth middleware")).toBe(0);
  });

  it("returns the highest relevance score across all skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations in order" },
      { taskCategory: "auth middleware", skillMarkdown: "Add JWT auth middleware for routes" },
    ];
    const overlap = maxNoveltyOverlap(skills, "add jwt auth middleware");
    expect(overlap).toBe(scoreSkillRelevance(skills[1]!, "add jwt auth middleware"));
  });
});
