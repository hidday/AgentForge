import { describe, it, expect, vi, afterEach } from "vitest";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

describe("OutputParser.parseJson — non-Error throw branch", () => {
  const parser = new OutputParser();
  const originalJsonParse = JSON.parse;

  afterEach(() => {
    JSON.parse = originalJsonParse;
  });

  it("stringifies a thrown non-Error value instead of reading .message", () => {
    // JSON.parse always throws a real SyntaxError in practice, so the
    // `String(err)` fallback branch is only reachable by forcing a non-Error
    // throw directly.
    vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "a plain string failure";
    });

    expect(() => parser.parseJson('{"a":1}')).toThrow(OutputParseError);
    try {
      parser.parseJson('{"a":1}');
      expect.fail("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON: a plain string failure");
    }
  });
});
