import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("similarity", () => {
  describe("extractTrigrams", () => {
    it("extracts overlapping lowercase trigrams and strips punctuation", () => {
      expect(extractTrigrams("Hi, world!")).toEqual(new Set(["hi ", "i w", " wo", "wor", "orl", "rld"]));
    });

    it("returns an empty set for strings shorter than 3 characters", () => {
      expect(extractTrigrams("ab")).toEqual(new Set());
      expect(extractTrigrams("")).toEqual(new Set());
    });
  });

  describe("trigramSimilarity", () => {
    it("returns 0 when both inputs are too short to produce trigrams", () => {
      expect(trigramSimilarity("", "")).toBe(0);
      expect(trigramSimilarity("ab", "cd")).toBe(0);
    });

    it("returns 1 for identical strings", () => {
      expect(trigramSimilarity("hello world", "hello world")).toBe(1);
    });

    it("returns a partial score for partially overlapping strings", () => {
      const score = trigramSimilarity("hello world", "hello there");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it("returns 0 for completely disjoint trigram sets", () => {
      expect(trigramSimilarity("aaa", "zzz")).toBe(0);
    });
  });

  describe("scoreSkillRelevance", () => {
    it("scores against taskCategory and skillMarkdown", () => {
      const score = scoreSkillRelevance(
        { taskCategory: "deploy pipeline", skillMarkdown: "how to deploy the pipeline" },
        "deploy pipeline",
      );
      expect(score).toBeGreaterThan(0);
    });

    it("includes name and description in scoring when present", () => {
      const withExtras = scoreSkillRelevance(
        {
          taskCategory: "unrelated",
          skillMarkdown: "unrelated content",
          name: "deploy-pipeline",
          description: "deploy pipeline automation",
        },
        "deploy pipeline",
      );
      const withoutExtras = scoreSkillRelevance(
        { taskCategory: "unrelated", skillMarkdown: "unrelated content" },
        "deploy pipeline",
      );
      expect(withExtras).toBeGreaterThan(withoutExtras);
    });

    it("ignores name/description when null", () => {
      const score = scoreSkillRelevance(
        { taskCategory: "deploy", skillMarkdown: "deploy stuff", name: null, description: null },
        "deploy",
      );
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("maxNoveltyOverlap", () => {
    it("returns 0 for an empty skills array", () => {
      expect(maxNoveltyOverlap([], "anything")).toBe(0);
    });

    it("returns the max relevance score across all skills", () => {
      const skills = [
        { taskCategory: "unrelated topic", skillMarkdown: "nothing in common here" },
        { taskCategory: "deploy pipeline", skillMarkdown: "how to deploy the pipeline" },
      ];
      const score = maxNoveltyOverlap(skills, "deploy pipeline");
      expect(score).toBeGreaterThan(0);
    });
  });
});
