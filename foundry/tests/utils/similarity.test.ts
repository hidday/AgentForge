import { describe, it, expect } from "vitest";
import { trigramSimilarity } from "../../src/utils/similarity.js";

describe("trigramSimilarity boundary cases", () => {
  it("returns 0 when both inputs produce no trigrams (empty strings)", () => {
    expect(trigramSimilarity("", "")).toBe(0);
  });

  it("returns 0 when both inputs are shorter than 3 characters", () => {
    // "ab" and "cd" each normalize to fewer than 3 characters, so both
    // trigram sets are empty -- this hits the early empty/empty return.
    expect(trigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 0 when one side is empty and the other has real trigrams", () => {
    expect(trigramSimilarity("", "something long enough")).toBe(0);
    expect(trigramSimilarity("something long enough", "")).toBe(0);
  });

  it("returns 1 for two identical non-trivial strings", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1);
  });
});
