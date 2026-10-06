import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping 3-char windows, lowercased", () => {
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  });

  it("strips punctuation before extracting trigrams", () => {
    const trigrams = extractTrigrams("a-b!c");
    // punctuation removed -> "abc" -> single trigram "abc"
    expect(trigrams).toEqual(new Set(["abc"]));
  });

  it("returns an empty set for input shorter than 3 characters", () => {
    expect(extractTrigrams("")).toEqual(new Set());
    expect(extractTrigrams("ab")).toEqual(new Set());
  });

  it("deduplicates repeated trigrams", () => {
    expect(extractTrigrams("aaaa")).toEqual(new Set(["aaa"]));
  });
});

describe("trigramSimilarity", () => {
  it("returns 0 when both inputs are too short to produce any trigrams (both-empty branch)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("ab", "x")).toBe(0);
  });

  it("returns 0 when one side has no trigrams but the other does (asymmetric empty)", () => {
    expect(trigramSimilarity("", "hello world")).toBe(0);
    expect(trigramSimilarity("hello world", "")).toBe(0);
  });

  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("hello world", "hello there");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint non-empty strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(trigramSimilarity("HELLO", "hello")).toBe(1);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "deployment automation",
    skillMarkdown: "This skill handles deployment automation for cloud sessions.".repeat(1),
  };

  it("scores using only taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "deployment automation");
    expect(score).toBeGreaterThan(0);
  });

  it("includes the name (with hyphens replaced by spaces) when present", () => {
    const skillWithName = { ...baseSkill, name: "deploy-automation-helper" };
    const scoreWithName = scoreSkillRelevance(skillWithName, "deploy automation helper");
    const scoreWithout = scoreSkillRelevance(baseSkill, "deploy automation helper");
    expect(scoreWithName).toBeGreaterThanOrEqual(scoreWithout);
  });

  it("includes the description when present", () => {
    const skillWithDescription = {
      ...baseSkill,
      description: "Handles zero-downtime rolling deploys",
    };
    const score = scoreSkillRelevance(skillWithDescription, "zero-downtime rolling deploys");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores a null name and a null description", () => {
    const skillWithNulls = { ...baseSkill, name: null, description: null };
    const score = scoreSkillRelevance(skillWithNulls, "deployment automation");
    expect(score).toBeGreaterThan(0);
  });

  it("truncates skillMarkdown comparison to the first 200 characters", () => {
    const longSkill = {
      taskCategory: "unrelated",
      skillMarkdown: "x".repeat(300) + "needle-phrase-at-the-end",
    };
    // "needle-phrase-at-the-end" sits past the 200-char slice, so it should
    // not contribute to the score.
    const score = scoreSkillRelevance(longSkill, "needle-phrase-at-the-end");
    expect(score).toBe(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the max relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "totally unrelated topic", skillMarkdown: "nothing in common here" },
      { taskCategory: "deployment automation", skillMarkdown: "deployment automation details" },
    ];
    const overlap = maxNoveltyOverlap(skills, "deployment automation");
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBe(
      Math.max(
        ...skills.map((s) => trigramSimilarity("deployment automation", s.taskCategory)),
      ),
    );
  });
});
