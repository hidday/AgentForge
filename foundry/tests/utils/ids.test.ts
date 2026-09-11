import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/ids.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a well-formed UUID v4 string", () => {
    const id = generateId();
    expect(id).toMatch(UUID_V4_RE);
  });

  it("returns a different value on each call", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});
