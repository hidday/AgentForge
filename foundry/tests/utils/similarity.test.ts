import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character windows, lowercased and punctuation-stripped", () => {
    const trigrams = extractTrigrams("Ab-C");
    expect(trigrams.has("abc")).toBe(true);
  });

  it("returns an empty set for a string shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both strings are empty", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 for completely dissimilar strings", () => {
    expect(trigramSimilarity("abc", "")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("add auth middleware", "add auth guard");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT for auth middleware." },
      "add auth middleware",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name field (with hyphens normalized to spaces) when present", () => {
    const withName = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content here",
        name: "add-auth-middleware",
      },
      "add auth middleware",
    );
    const withoutName = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content here" },
      "add auth middleware",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("includes the description field when present", () => {
    const withDescription = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content here",
        description: "Use when adding auth middleware",
      },
      "add auth middleware",
    );
    const withoutDescription = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: "unrelated content here" },
      "add auth middleware",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });

  it("only scores against the first 200 chars of skillMarkdown", () => {
    const longMarkdown = "x".repeat(200) + "add auth middleware";
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: longMarkdown },
      "add auth middleware",
    );
    // The matching text lives past the 200-char cutoff, so it should not contribute.
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skill list", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all skills", () => {
    const skills = [
      { taskCategory: "database migration", skillMarkdown: "Run alembic migrations" },
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT for auth middleware" },
    ];
    const overlap = maxNoveltyOverlap(skills, "add auth middleware now");
    const expected = Math.max(
      scoreSkillRelevance(skills[0]!, "add auth middleware now"),
      scoreSkillRelevance(skills[1]!, "add auth middleware now"),
    );
    expect(overlap).toBe(expected);
    expect(overlap).toBeGreaterThan(0);
  });
});
