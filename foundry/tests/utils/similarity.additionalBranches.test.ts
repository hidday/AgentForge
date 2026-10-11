import { describe, it, expect } from "vitest";
import { extractTrigrams, trigramSimilarity, scoreSkillRelevance, maxNoveltyOverlap } from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("returns an empty set for strings shorter than 3 characters", () => {
    expect(extractTrigrams("").size).toBe(0);
    expect(extractTrigrams("ab").size).toBe(0);
  });

  it("extracts overlapping trigrams, lowercased and stripped of punctuation (spaces kept)", () => {
    const trigrams = extractTrigrams("Hi, World!");
    // Punctuation (",", "!") is stripped but whitespace is preserved, so
    // "Hi, World!" normalizes to "hi world" before trigram extraction.
    expect(trigrams.has("hi ")).toBe(true);
    expect(trigrams.has("wor")).toBe(true);
    expect(trigrams.has("rld")).toBe(true);
  });
});

describe("trigramSimilarity — both-empty short-circuit", () => {
  it("returns 0 when both inputs are too short to produce any trigrams", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("a", "bc")).toBe(0);
  });

  it("returns 0 when only one side is too short to produce trigrams (no shared trigrams)", () => {
    expect(trigramSimilarity("ab", "hello world")).toBe(0);
  });

  it("returns 1 for identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns a value strictly between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("deploy the service", "deploy the pipeline");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "deployment",
    skillMarkdown: "# Deploy\nHow to deploy the service safely.",
  };

  it("scores using taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "deployment");
    expect(score).toBeGreaterThan(0);
  });

  it("factors in name (hyphens replaced with spaces) when present", () => {
    const score = scoreSkillRelevance({ ...baseSkill, name: "deploy-service" }, "deploy service");
    expect(score).toBeGreaterThan(0);
  });

  it("factors in description when present", () => {
    const score = scoreSkillRelevance(
      { ...baseSkill, description: "Safely deploy services to production" },
      "deploy services to production",
    );
    expect(score).toBeGreaterThan(0);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty existing-skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the max relevance score across all existing skills", () => {
    const skills = [
      { taskCategory: "unrelated", skillMarkdown: "nothing in common here" },
      { taskCategory: "deployment", skillMarkdown: "deploy the service safely" },
    ];
    const score = maxNoveltyOverlap(skills, "deploy the service");
    expect(score).toBeGreaterThan(0);
  });
});
