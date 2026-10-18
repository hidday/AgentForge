import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-char windows, lowercased, punctuation stripped", () => {
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
    expect(extractTrigrams("ABC!")).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("")).toEqual(new Set());
    expect(extractTrigrams("ab")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely dissimilar strings", () => {
    expect(trigramSimilarity("abcdef", "ghijkl")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("add auth middleware", "add auth logging");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when both strings are too short to form any trigram", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("ab", "yz")).toBe(0);
  });

  it("returns 0 when one string is empty/too short and the other is a normal string (no shared trigrams)", () => {
    expect(trigramSimilarity("", "a full sentence here")).toBe(0);
    expect(trigramSimilarity("ab", "a full sentence here")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores higher for a skill whose taskCategory closely matches the query", () => {
    const authSkill = { taskCategory: "auth middleware", skillMarkdown: "JWT token setup" };
    const unrelatedSkill = { taskCategory: "database migration", skillMarkdown: "alembic steps" };
    const query = "add JWT authentication middleware";

    expect(scoreSkillRelevance(authSkill, query)).toBeGreaterThan(
      scoreSkillRelevance(unrelatedSkill, query),
    );
  });

  it("considers only the first 200 chars of skillMarkdown", () => {
    const longMarkdown = "z".repeat(500) + "add auth middleware with JWT tokens";
    const skill = { taskCategory: "unrelated", skillMarkdown: longMarkdown };
    // The relevant text is past the 200-char cutoff, so it should not raise the score.
    const score = scoreSkillRelevance(skill, "add auth middleware with JWT tokens");
    expect(score).toBeLessThan(0.5);
  });

  it("includes name and description in the scored fields when present", () => {
    const base = { taskCategory: "unrelated-category", skillMarkdown: "unrelated body text" };
    const withName = { ...base, name: "add auth middleware" };
    const query = "add auth middleware";

    expect(scoreSkillRelevance(withName, query)).toBeGreaterThan(scoreSkillRelevance(base, query));
  });

  it("ignores name/description fields when they are null or absent", () => {
    const skill = {
      taskCategory: "auth middleware",
      skillMarkdown: "JWT setup",
      name: null,
      description: null,
    };
    expect(() => scoreSkillRelevance(skill, "add auth middleware")).not.toThrow();
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 when there are no existing skills", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the highest relevance score among existing skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "alembic steps" },
      { taskCategory: "auth middleware", skillMarkdown: "JWT token setup for auth middleware" },
    ];
    const overlap = maxNoveltyOverlap(skills, "add JWT auth middleware");
    const expectedMax = Math.max(
      ...skills.map((s) => trigramSimilarity("add JWT auth middleware", s.taskCategory)),
    );
    expect(overlap).toBeGreaterThanOrEqual(expectedMax);
    expect(overlap).toBeGreaterThan(0);
  });
});
