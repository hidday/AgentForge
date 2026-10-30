import { describe, it, expect } from "vitest";
import {
  extractTrigrams,
  trigramSimilarity,
  scoreSkillRelevance,
  maxNoveltyOverlap,
} from "../../src/utils/similarity.js";

describe("extractTrigrams", () => {
  it("extracts overlapping lowercase trigrams", () => {
    expect(extractTrigrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  });

  it("lowercases and strips punctuation before extracting", () => {
    expect(extractTrigrams("AB-CD!")).toEqual(extractTrigrams("abcd"));
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

  it("returns 0 when both inputs are empty/too short for trigrams", () => {
    expect(trigramSimilarity("", "")).toBe(0);
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 0 for completely disjoint trigram sets", () => {
    expect(trigramSimilarity("aaaa", "zzzz")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = trigramSimilarity("deploy the service", "deploy the application");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreSkillRelevance", () => {
  const baseSkill = {
    taskCategory: "dev-env pause/resume tooling",
    skillMarkdown: "# Pause/resume footguns\n\nAlways pass -var-file.",
  };

  it("scores against taskCategory and skillMarkdown when name/description are absent", () => {
    const score = scoreSkillRelevance(baseSkill, "pause resume tooling");
    expect(score).toBeGreaterThan(0);
  });

  it("includes name in scoring when present, with hyphens treated as spaces", () => {
    const withName = { ...baseSkill, name: "pause-resume-footguns" };
    const scoreWithName = scoreSkillRelevance(withName, "pause resume footguns");
    const scoreWithout = scoreSkillRelevance(baseSkill, "pause resume footguns");
    expect(scoreWithName).toBeGreaterThanOrEqual(scoreWithout);
  });

  it("includes description in scoring when present", () => {
    const withDescription = {
      ...baseSkill,
      description: "terraform var-file footgun workaround",
    };
    const score = scoreSkillRelevance(withDescription, "terraform var-file footgun");
    expect(score).toBeGreaterThan(0);
  });

  it("ignores name/description when null", () => {
    const withNulls = { ...baseSkill, name: null, description: null };
    expect(scoreSkillRelevance(withNulls, "pause resume tooling")).toBe(
      scoreSkillRelevance(baseSkill, "pause resume tooling"),
    );
  });

  it("only considers the first 200 chars of skillMarkdown", () => {
    const longMarkdown = "x".repeat(300) + " unique-tail-content";
    const skill = { ...baseSkill, skillMarkdown: longMarkdown };
    const score = scoreSkillRelevance(skill, "unique-tail-content");
    // The matching text is beyond the 200-char window, so it shouldn't
    // contribute meaningfully (only overlap with the "x" run via taskCategory).
    expect(score).toBeLessThan(0.5);
  });
});

describe("maxNoveltyOverlap", () => {
  it("returns 0 for an empty skills array", () => {
    expect(maxNoveltyOverlap([], "anything")).toBe(0);
  });

  it("returns the maximum relevance score across all skills", () => {
    const skills = [
      { taskCategory: "unrelated topic", skillMarkdown: "nothing in common" },
      { taskCategory: "dev-env pause resume tooling", skillMarkdown: "pause resume" },
    ];
    const score = maxNoveltyOverlap(skills, "dev-env pause resume tooling");
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(
      Math.max(
        ...skills.map((s) =>
          Math.max(
            trigramSimilarity("dev-env pause resume tooling", s.taskCategory),
            trigramSimilarity("dev-env pause resume tooling", s.skillMarkdown.slice(0, 200)),
          ),
        ),
      ),
    );
  });
});
