import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/ids.js";

describe("generateId", () => {
  it("returns a valid v4 UUID", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("returns a different value on each call", () => {
    const first = generateId();
    const second = generateId();
    expect(first).not.toBe(second);
  });
});
