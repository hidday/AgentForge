import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-char sequences after lowercasing", () => {
    expect(extractTrigrams("ABC")).toEqual(new Set(["abc"]));
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting trigrams", () => {
    expect(extractTrigrams("a-b!c")).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("")).toEqual(new Set());
    expect(extractTrigrams("ab")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("aaa", "zzz")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("add auth middleware", "add auth guards");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when both strings are too short to produce any trigrams", () => {
    // Neither string reaches 3 characters, so both trigram sets are empty —
    // exercises the explicit both-empty early return rather than falling
    // through to the union-based computation.
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores based on the max of taskCategory and skillMarkdown similarity", () => {
    const skill = { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth." };
    const score = scoreSkillRelevance(skill, "add JWT authentication middleware");
    expect(score).toBeGreaterThan(0);
  });

  it("also considers the skill name (with dashes replaced by spaces) when present", () => {
    const withName = scoreSkillRelevance(
      { taskCategory: "zzz", skillMarkdown: "zzz", name: "auth-middleware-setup" },
      "auth middleware setup",
    );
    const withoutName = scoreSkillRelevance(
      { taskCategory: "zzz", skillMarkdown: "zzz" },
      "auth middleware setup",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("also considers the skill description when present", () => {
    const withDescription = scoreSkillRelevance(
      { taskCategory: "zzz", skillMarkdown: "zzz", description: "Use when adding rate limiting" },
      "add rate limiting to the API",
    );
    const withoutDescription = scoreSkillRelevance(
      { taskCategory: "zzz", skillMarkdown: "zzz" },
      "add rate limiting to the API",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });

  it("only considers the first 200 chars of skillMarkdown", () => {
    const longMarkdown = "filler ".repeat(50) + "unique-tail-marker-xyz";
    const score = scoreSkillRelevance(
      { taskCategory: "zzz", skillMarkdown: longMarkdown },
      "unique-tail-marker-xyz",
    );
    // The unique tail is beyond char 200, so similarity should stay low (near 0),
    // not high as it would be if the whole markdown were compared.
    expect(score).toBeLessThan(0.3);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skill list", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations in order" },
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth in middleware" },
    ];
    const overlap = maxNoveltyOverlap(skills, "add JWT authentication middleware");
    const expectedMax = Math.max(
      ...skills.map((s) => trigramSimilarity("add JWT authentication middleware", s.taskCategory)),
      ...skills.map((s) =>
        trigramSimilarity("add JWT authentication middleware", s.skillMarkdown.slice(0, 200)),
      ),
    );
    expect(overlap).toBeCloseTo(expectedMax, 5);
    expect(overlap).toBeGreaterThan(0);
  });
});
