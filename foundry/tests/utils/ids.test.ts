import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/ids.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("utils/ids", () => {
  it("generateId returns a string matching the UUID v4 format", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(UUID_V4_RE);
  });

  it("generateId returns a unique value on each call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId()));
    expect(ids.size).toBe(50);
  });
});
