import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("utils/similarity", () => {
  describe("extractTrigrams", () => {
    it("returns an empty set for strings shorter than 3 characters", () => {
      expect(extractTrigrams("")).toEqual(new Set());
      expect(extractTrigrams("ab")).toEqual(new Set());
    });

    it("lowercases and strips punctuation before extracting trigrams", () => {
      const trigrams = extractTrigrams("Hi, Bob!");
      // "Hi, Bob!" -> "hi bob" -> trigrams: "hi ", "i b", " bo", "bob"
      expect(trigrams).toEqual(new Set(["hi ", "i b", " bo", "bob"]));
    });

    it("extracts all overlapping 3-character windows", () => {
      const trigrams = extractTrigrams("abcd");
      expect(trigrams).toEqual(new Set(["abc", "bcd"]));
    });
  });

  describe("trigramSimilarity", () => {
    it("returns 0 when both strings are empty", () => {
      expect(trigramSimilarity("", "")).toBe(0);
    });

    it("returns 0 when one string is empty and the other is not (no shared trigrams)", () => {
      expect(trigramSimilarity("", "hello")).toBe(0);
      expect(trigramSimilarity("hello", "")).toBe(0);
    });

    it("returns 1 for identical non-empty strings", () => {
      expect(trigramSimilarity("deploy the service", "deploy the service")).toBe(1);
    });

    it("returns 0 for strings with no trigram overlap", () => {
      expect(trigramSimilarity("abc", "xyz")).toBe(0);
    });

    it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
      const score = trigramSimilarity("database migration task", "database rollback task");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it("is symmetric", () => {
      const a = "refactor the payment pipeline";
      const b = "refactor the billing pipeline";
      expect(trigramSimilarity(a, b)).toBeCloseTo(trigramSimilarity(b, a), 10);
    });
  });

  describe("scoreSkillRelevance", () => {
    it("scores against taskCategory and the first 200 chars of skillMarkdown, taking the max", () => {
      const skill = {
        taskCategory: "database migrations",
        skillMarkdown: "x".repeat(300) + "database migrations",
      };
      const score = scoreSkillRelevance(skill, "database migrations");
      // taskCategory matches the query exactly -> similarity 1, which is the max.
      expect(score).toBe(1);
    });

    it("includes the name (with dashes replaced by spaces) when present", () => {
      const skill = {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally unrelated markdown content",
        name: "database-migrations",
      };
      const withName = scoreSkillRelevance(skill, "database migrations");
      const withoutName = scoreSkillRelevance(
        { taskCategory: skill.taskCategory, skillMarkdown: skill.skillMarkdown },
        "database migrations",
      );
      expect(withName).toBeGreaterThan(withoutName);
    });

    it("includes the description when present", () => {
      const skill = {
        taskCategory: "unrelated-category",
        skillMarkdown: "totally unrelated markdown content",
        description: "How to safely run database migrations",
      };
      const withDescription = scoreSkillRelevance(skill, "database migrations");
      const withoutDescription = scoreSkillRelevance(
        { taskCategory: skill.taskCategory, skillMarkdown: skill.skillMarkdown },
        "database migrations",
      );
      expect(withDescription).toBeGreaterThan(withoutDescription);
    });

    it("ignores name/description when they are null", () => {
      const skill = {
        taskCategory: "database migrations",
        skillMarkdown: "irrelevant",
        name: null,
        description: null,
      };
      const score = scoreSkillRelevance(skill, "database migrations");
      expect(score).toBe(1);
    });
  });

  describe("maxNoveltyOverlap", () => {
    it("returns 0 for an empty skills array", () => {
      expect(maxNoveltyOverlap([], "any query")).toBe(0);
    });

    it("returns the max relevance score across all existing skills", () => {
      const skills = [
        { taskCategory: "totally unrelated topic", skillMarkdown: "nothing in common" },
        { taskCategory: "database migrations", skillMarkdown: "database migrations" },
      ];
      const score = maxNoveltyOverlap(skills, "database migrations");
      expect(score).toBe(1);
    });

    it("returns a low score when no existing skill overlaps with the query", () => {
      const skills = [{ taskCategory: "zzz qqq xxx", skillMarkdown: "zzz qqq xxx" }];
      const score = maxNoveltyOverlap(skills, "aaa bbb ccc");
      expect(score).toBe(0);
    });
  });
});
