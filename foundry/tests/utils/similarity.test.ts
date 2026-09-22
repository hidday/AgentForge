import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences", () => {
    const result = extractTrigrams("abcd");
    expect(result).toEqual(new Set(["abc", "bcd"]));
  });

  it("lowercases input before extracting trigrams", () => {
    const result = extractTrigrams("ABC");
    expect(result).toEqual(new Set(["abc"]));
  });

  it("strips punctuation before extracting trigrams", () => {
    const result = extractTrigrams("a-b!c");
    expect(result).toEqual(extractTrigrams("abc"));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });

  it("deduplicates repeated trigrams", () => {
    const result = extractTrigrams("aaaa");
    expect(result).toEqual(new Set(["aaa"]));
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns 0 when both strings are empty (both trigram sets empty)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both strings are too short to form any trigram", () => {
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns a partial score for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is symmetric", () => {
    const a = trigramSimilarity("database migration", "migrate the database");
    const b = trigramSimilarity("migrate the database", "database migration");
    expect(a).toBe(b);
  });
});

describe("scoreSkillRelevance", () => {
  it("scores against taskCategory and the first 200 chars of skillMarkdown", () => {
    const skill = {
      taskCategory: "auth-refactor",
      skillMarkdown: "auth-refactor guidance for OAuth2 migrations",
    };
    const score = scoreSkillRelevance(skill, "auth-refactor");
    expect(score).toBeGreaterThan(0);
  });

  it("includes name (with hyphens replaced by spaces) in the max when present", () => {
    const skill = {
      taskCategory: "db-migration",
      skillMarkdown: "irrelevant content unrelated to the query at all",
      name: "oauth-two-migration",
    };
    const withName = scoreSkillRelevance(skill, "oauth two migration");
    const withoutName = scoreSkillRelevance(
      { taskCategory: skill.taskCategory, skillMarkdown: skill.skillMarkdown },
      "oauth two migration",
    );
    expect(withName).toBeGreaterThan(withoutName);
  });

  it("includes description in the max when present", () => {
    const skill = {
      taskCategory: "db-migration",
      skillMarkdown: "irrelevant content unrelated to the query at all",
      description: "How to safely run schema migrations",
    };
    const withDescription = scoreSkillRelevance(skill, "schema migrations");
    const withoutDescription = scoreSkillRelevance(
      { taskCategory: skill.taskCategory, skillMarkdown: skill.skillMarkdown },
      "schema migrations",
    );
    expect(withDescription).toBeGreaterThan(withoutDescription);
  });

  it("ignores null name and null description", () => {
    const skill = {
      taskCategory: "generic",
      skillMarkdown: "some content",
      name: null,
      description: null,
    };
    expect(() => scoreSkillRelevance(skill, "query")).not.toThrow();
  });

  it("returns the maximum score across all considered fields", () => {
    const skill = {
      taskCategory: "zzz-unrelated",
      skillMarkdown: "zzz unrelated markdown body",
      name: "exact-match-query",
    };
    const score = scoreSkillRelevance(skill, "exact match query");
    // The name field should dominate since it closely matches the query.
    expect(score).toBeGreaterThan(
      trigramSimilarity("exact match query", skill.taskCategory),
    );
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "any query")).toBe(0);
  });

  it("returns the highest relevance score among existing skills", () => {
    const skills = [
      { taskCategory: "unrelated", skillMarkdown: "totally different content here" },
      { taskCategory: "auth-refactor", skillMarkdown: "auth-refactor OAuth2 migration guidance" },
    ];
    const score = maxNoveltyOverlap(skills, "auth-refactor");
    const expectedMax = Math.max(
      ...skills.map((s) => trigramSimilarity("auth-refactor", s.taskCategory)),
    );
    expect(score).toBeGreaterThanOrEqual(expectedMax);
  });
});
