import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/ids.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a string matching the standard UUID v4 format", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("returns different values on consecutive calls", () => {
    const first = generateId();
    const second = generateId();
    expect(first).not.toBe(second);
  });
});
