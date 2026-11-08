import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const parser = new OutputParser();
const schema = z.object({ name: z.string(), age: z.number() });

describe("OutputParser.extractStructuredBlock()", () => {
  it("extracts and trims the text between the BEGIN/END delimiters", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n  {"ok":true}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });

  it("uses the last BEGIN delimiter when it appears more than once", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"first":true}\n${STRUCTURED_OUTPUT_END}\nmore chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"second":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"second":true}');
  });

  it("throws OutputParseError with a tail snippet when the BEGIN delimiter is missing", () => {
    const raw = "x".repeat(600) + "[END_OF_RAW]";
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toContain("[END_OF_RAW]");
      expect(e.rawOutput!.length).toBeLessThanOrEqual(500);
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"unterminated":true}`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.rawOutput).toContain('{"unterminated":true}');
    }
  });

  it("only searches for END after the matched BEGIN, not before it", () => {
    // An END-looking token before BEGIN must not satisfy the search.
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });
});

describe("OutputParser.parseJson()", () => {
  it("parses a valid JSON object", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a head snippet of the offending block on invalid JSON", () => {
    const block = "{not valid json" + "z".repeat(600);
    try {
      parser.parseJson(block);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toContain("{not valid json");
      expect(e.rawOutput!.length).toBeLessThanOrEqual(500);
    }
  });

  it("coerces a non-Error thrown value to a string in the error message (defensive branch)", () => {
    // JSON.parse always throws a SyntaxError in practice, but the catch
    // handler defends against any thrown value. Stub JSON.parse for this one
    // call to exercise that defensive `String(err)` fallback.
    const originalParse = JSON.parse;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "not an Error instance";
    });
    try {
      parser.parseJson('{"a":1}');
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(
        "Failed to parse JSON: not an Error instance",
      );
    } finally {
      JSON.parse = originalParse;
      vi.restoreAllMocks();
    }
  });
});

describe("OutputParser.validate()", () => {
  it("returns the validated/typed data on success", () => {
    const result = parser.validate({ name: "a", age: 1 }, schema);
    expect(result).toEqual({ name: "a", age: 1 });
  });

  it("throws OutputParseError listing each schema issue by path on failure", () => {
    try {
      parser.validate({ name: 123, age: "old" }, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("name:");
      expect(e.message).toContain("age:");
      expect(e.rawOutput).toContain('"name":123');
    }
  });

  it("truncates a very large invalid payload's rawOutput to 500 chars", () => {
    const bigInvalid = { name: 123, age: "x".repeat(1000) };
    try {
      parser.validate(bigInvalid, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput!.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("OutputParser.parse() — end-to-end", () => {
  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `notes\n${STRUCTURED_OUTPUT_BEGIN}\n{"name":"Ada","age":30}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ name: "Ada", age: 30 });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the JSON doesn't match the schema", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"name":"Ada"}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/schema validation/);
  });
});
