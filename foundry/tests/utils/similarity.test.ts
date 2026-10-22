import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("similarity", () => {
  describe("extractTrigrams", () => {
    it("lowercases, strips punctuation, and extracts overlapping 3-char windows", () => {
      const trigrams = extractTrigrams("Add-Auth!");
      expect(trigrams).toEqual(new Set(["add", "dda", "dau", "aut", "uth"]));
    });

    it("returns an empty set for strings shorter than 3 characters", () => {
      expect(extractTrigrams("ab")).toEqual(new Set());
      expect(extractTrigrams("")).toEqual(new Set());
    });
  });

  describe("trigramSimilarity", () => {
    it("returns 1 for identical non-empty strings", () => {
      expect(trigramSimilarity("auth middleware", "auth middleware")).toBe(1);
    });

    it("returns 0 when both strings are empty (no trigrams at all)", () => {
      expect(trigramSimilarity("", "")).toBe(0);
    });

    it("returns 0 when exactly one string is too short to have trigrams (asymmetric empty case)", () => {
      // Covers the branch where only ONE side is empty, distinct from the
      // both-empty early-return case above.
      expect(trigramSimilarity("", "auth middleware")).toBe(0);
      expect(trigramSimilarity("auth middleware", "ab")).toBe(0);
    });

    it("returns a partial score for overlapping-but-different strings", () => {
      const score = trigramSimilarity("auth middleware", "auth service");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  describe("scoreSkillRelevance", () => {
    it("scores against taskCategory and skillMarkdown, taking the max", () => {
      const score = scoreSkillRelevance(
        { taskCategory: "auth middleware", skillMarkdown: "Use JWT for auth." },
        "auth middleware",
      );
      expect(score).toBe(1); // exact match against taskCategory
    });

    it("also considers name (hyphens replaced with spaces) and description when present", () => {
      const withNameAndDescription = scoreSkillRelevance(
        {
          taskCategory: "unrelated",
          skillMarkdown: "unrelated content",
          name: "auth-middleware",
          description: "auth middleware helper",
        },
        "auth middleware",
      );
      const withoutNameAndDescription = scoreSkillRelevance(
        { taskCategory: "unrelated", skillMarkdown: "unrelated content" },
        "auth middleware",
      );
      expect(withNameAndDescription).toBeGreaterThan(withoutNameAndDescription);
    });

    it("ignores name/description when they are null or absent", () => {
      const score = scoreSkillRelevance(
        {
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT.",
          name: null,
          description: null,
        },
        "auth middleware",
      );
      expect(score).toBe(1);
    });
  });

  describe("maxNoveltyOverlap", () => {
    it("returns 0 for an empty skill pool", () => {
      expect(maxNoveltyOverlap([], "any query")).toBe(0);
    });

    it("returns the highest relevance score across all skills", () => {
      const skills = [
        { taskCategory: "database migration", skillMarkdown: "Run migrations in order." },
        { taskCategory: "auth middleware", skillMarkdown: "Use JWT for auth middleware." },
      ];
      const overlap = maxNoveltyOverlap(skills, "add auth middleware");
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBe(
        Math.max(
          trigramSimilarity("add auth middleware", "database migration"),
          trigramSimilarity("add auth middleware", "Run migrations in order.".slice(0, 200)),
          trigramSimilarity("add auth middleware", "auth middleware"),
          trigramSimilarity("add auth middleware", "Use JWT for auth middleware.".slice(0, 200)),
        ),
      );
    });
  });
});
