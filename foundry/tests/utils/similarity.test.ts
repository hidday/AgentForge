import { describe, it, expect } from "vitest";
import { extractTrigrams, trigramSimilarity, scoreSkillRelevance, maxNoveltyOverlap } from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-character sequences, lowercased with punctuation stripped", () => {
    expect(extractTrigrams("Ab-c")).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("ab").size).toBe(0);
    expect(extractTrigrams("").size).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 when both strings are empty (both-empty branch)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both strings are too short to produce trigrams (both-empty-set branch)", () => {
    expect(trigramSimilarity("a", "bb")).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("is asymmetric-safe: order of arguments does not change the result", () => {
    const a = trigramSimilarity("database migration", "schema migration tool");
    const b = trigramSimilarity("schema migration tool", "database migration");
    expect(a).toBe(b);
  });
});

describe("scoreSkillRelevance", () => {
  const skill = {
    taskCategory: "database migrations",
    skillMarkdown: "# Database Migrations\nHandles schema changes safely.",
    name: "db-migrations",
    description: "Guidance for writing safe database migrations",
  };

  it("takes the max similarity across taskCategory, markdown prefix, name, and description", () => {
    const score = scoreSkillRelevance(skill, "database migrations");
    expect(score).toBeGreaterThan(0.5);
  });

  it("works when name and description are omitted", () => {
    const score = scoreSkillRelevance(
      { taskCategory: skill.taskCategory, skillMarkdown: skill.skillMarkdown },
      "database migrations",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("works when name/description are explicitly null", () => {
    const score = scoreSkillRelevance(
      { ...skill, name: null, description: null },
      "database migrations",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("only considers the first 200 chars of skillMarkdown", () => {
    const longMarkdown = `# Unrelated Title\n${"x".repeat(250)}\ndatabase migrations relevant text`;
    const score = scoreSkillRelevance(
      { taskCategory: "unrelated-category-zzz", skillMarkdown: longMarkdown },
      "database migrations",
    );
    // The relevant text is past the 200-char cutoff, so similarity should be low.
    expect(score).toBeLessThan(0.2);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the max relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated topic", skillMarkdown: "nothing relevant here" },
      { taskCategory: "database migrations", skillMarkdown: "database migrations guide" },
    ];
    const score = maxNoveltyOverlap(skills, "database migrations");
    expect(score).toBeGreaterThan(0.5);
  });
});
