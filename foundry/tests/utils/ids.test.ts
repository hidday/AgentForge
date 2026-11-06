import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/ids.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a string in UUID v4 format", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(UUID_V4_RE);
  });

  it("generates a unique value on every call", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateId()));
    expect(ids.size).toBe(500);
  });

  it("does not return the same id twice in a row", () => {
    const first = generateId();
    const second = generateId();
    expect(first).not.toBe(second);
  });
});
