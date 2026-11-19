import { describe, it, expect } from "vitest";
// Using a value-position import (not `import type`) so this type-only module
// actually gets loaded at runtime and picked up by coverage instrumentation.
import * as RunnerTypes from "../../src/runtime/runnerTypes.js";

describe("runnerTypes", () => {
  it("is a pure type-definition module with no runtime exports", () => {
    expect(RunnerTypes).toBeDefined();
    expect(Object.keys(RunnerTypes)).toEqual([]);
  });
});
