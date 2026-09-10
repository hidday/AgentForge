import { describe, it, expect } from "vitest";
import { extractTrigrams, trigramSimilarity, scoreSkillRelevance, maxNoveltyOverlap } from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character windows", () => {
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  });

  it("lowercases and strips punctuation before extracting", () => {
    expect(extractTrigrams("A-B C!")).toEqual(extractTrigrams("ab c"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab")).toEqual(new Set());
    expect(extractTrigrams("")).toEqual(new Set());
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("abcdef", "xyzxyz")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("database migrations", "database backups");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when both strings are too short to produce trigrams", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown, taking the max", () => {
    const score = scoreSkillRelevance(
      { taskCategory: "auth middleware", skillMarkdown: "Use JWT tokens for auth middleware." },
      "auth middleware",
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it("also considers name (with dashes replaced by spaces) when present", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content here",
        name: "auth-middleware-hardening",
      },
      "auth middleware hardening",
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it("also considers description when present", () => {
    const score = scoreSkillRelevance(
      {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated content here",
        description: "Guidance for hardening authentication middleware",
      },
      "Guidance for hardening authentication middleware",
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it("ignores name/description when they are null or absent", () => {
    const withNulls = scoreSkillRelevance(
      { taskCategory: "x", skillMarkdown: "y", name: null, description: null },
      "unrelated query",
    );
    const withoutFields = scoreSkillRelevance({ taskCategory: "x", skillMarkdown: "y" }, "unrelated query");
    expect(withNulls).toBe(withoutFields);
  });

  it("only scores against the first 200 characters of skillMarkdown", () => {
    const longMarkdown = "z".repeat(300) + "unique-marker-at-the-end";
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated", skillMarkdown: longMarkdown },
      "unique-marker-at-the-end",
    );
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the maximum relevance score across all skills", () => {
    const skills = [
      { taskCategory: "totally unrelated topic", skillMarkdown: "nothing in common" },
      { taskCategory: "database migrations", skillMarkdown: "Use Prisma for database migrations." },
    ];
    const overlap = maxNoveltyOverlap(skills, "database migrations");
    expect(overlap).toBeGreaterThan(0.5);
  });
});
