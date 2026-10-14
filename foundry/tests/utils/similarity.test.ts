import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("similarity", () => {
  describe("extractTrigrams", () => {
    it("lowercases and strips punctuation before extracting trigrams", () => {
      expect(extractTrigrams("Ab-C!")).toEqual(new Set(["abc"]));
    });

    it("returns an empty set for strings shorter than 3 characters", () => {
      expect(extractTrigrams("ab")).toEqual(new Set());
      expect(extractTrigrams("")).toEqual(new Set());
    });
  });

  describe("trigramSimilarity", () => {
    it("returns 0 when both inputs are too short to produce any trigrams", () => {
      expect(trigramSimilarity("ab", "cd")).toBe(0);
      expect(trigramSimilarity("", "")).toBe(0);
    });

    it("returns 0 when only one side has trigrams and they share nothing", () => {
      expect(trigramSimilarity("ab", "hello world")).toBe(0);
    });

    it("returns 1 for identical non-trivial strings", () => {
      expect(trigramSimilarity("hello world", "hello world")).toBe(1);
    });

    it("returns a value strictly between 0 and 1 for partially-overlapping strings", () => {
      const score = trigramSimilarity("hello world", "hello there");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  describe("scoreSkillRelevance", () => {
    it("scores against taskCategory and skillMarkdown and returns the max", () => {
      const skill = { taskCategory: "deploy pipeline", skillMarkdown: "unrelated text" };
      const score = scoreSkillRelevance(skill, "deploy pipeline");
      expect(score).toBe(1);
    });

    it("also considers name and description when present", () => {
      const skill = {
        taskCategory: "unrelated",
        skillMarkdown: "unrelated",
        name: "deploy-pipeline",
        description: "unrelated",
      };
      const score = scoreSkillRelevance(skill, "deploy pipeline");
      expect(score).toBe(1);
    });

    it("ignores name/description when absent", () => {
      const skill = { taskCategory: "unrelated", skillMarkdown: "unrelated" };
      expect(scoreSkillRelevance(skill, "deploy pipeline")).toBe(0);
    });
  });

  describe("maxNoveltyOverlap", () => {
    it("returns 0 for an empty skills array", () => {
      expect(maxNoveltyOverlap([], "anything")).toBe(0);
    });

    it("returns the max relevance across all existing skills", () => {
      const skills = [
        { taskCategory: "unrelated", skillMarkdown: "unrelated" },
        { taskCategory: "deploy pipeline", skillMarkdown: "unrelated" },
      ];
      expect(maxNoveltyOverlap(skills, "deploy pipeline")).toBe(1);
    });
  });
});
