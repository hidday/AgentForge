import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/ids.js";

// UUID v4 format: 8-4-4-4-12 hex digits, version nibble "4", variant nibble in [8,9,a,b]
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a string matching the UUID v4 format", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("returns different values on successive calls", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it("returns many unique values across repeated calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});
