import { describe, it, expect, vi } from "vitest";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

// Covers parseJson()'s "non-Error rejection" ternary branch
// (`err instanceof Error ? err.message : String(err)`). JSON.parse always
// throws a real SyntaxError (an Error instance) for malformed input, so the
// only way to exercise the defensive non-Error fallback is to have the
// underlying JSON.parse itself throw something else -- which is exactly the
// kind of situation this ternary defends against (e.g. a patched/sandboxed
// JSON implementation, or a hostile Proxy).

describe("OutputParser.parseJson — non-Error throw from JSON.parse", () => {
  it("stringifies a non-Error value thrown by JSON.parse into the OutputParseError message", () => {
    const parser = new OutputParser();
    const spy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "not an Error instance";
    });

    try {
      expect(() => parser.parseJson("{}")).toThrow(OutputParseError);
      expect(() => parser.parseJson("{}")).toThrow(/Failed to parse JSON: not an Error instance/);
    } finally {
      spy.mockRestore();
    }
  });
});
