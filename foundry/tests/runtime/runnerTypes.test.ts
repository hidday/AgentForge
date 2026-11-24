import { describe, it, expect } from "vitest";

describe("runnerTypes", () => {
  it("is a type-only module with no runtime value exports", async () => {
    const mod = await import("../../src/runtime/runnerTypes.js");
    expect(Object.keys(mod)).toEqual([]);
  });
});
