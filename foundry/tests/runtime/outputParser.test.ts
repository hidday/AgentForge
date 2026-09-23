import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string() });

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the begin/end delimiters", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n  {"value":"ok"}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
  });

  it("uses the LAST begin delimiter when there are multiple", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"first"}\n${STRUCTURED_OUTPUT_END}\nmore chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"second"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"second"}');
  });

  it("throws OutputParseError when the begin delimiter is missing entirely", () => {
    const raw = "just some plain text with no delimiters";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError with a tail slice when raw is longer than 500 chars and begin delimiter is missing", () => {
    const raw = "y".repeat(600) + "[END_MARKER]";
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toBe(raw.slice(-500));
      expect(e.rawOutput).toContain("[END_MARKER]");
      expect(e.rawOutput?.length).toBe(500);
    }
  });

  it("throws OutputParseError when begin delimiter is present but end delimiter is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\nno end here`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.rawOutput).toContain('{"value":"ok"}');
    }
  });

  it("does not match an END delimiter that appears before the chosen BEGIN delimiter", () => {
    // END appears earlier in the string, but only after the *last* BEGIN
    // should we search for it -- so this must still fail to find a match.
    const raw = `${STRUCTURED_OUTPUT_END}\nsome text\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and a snippet of the block on invalid JSON", () => {
    const block = "{not valid json,,,";
    try {
      parser.parseJson(block);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("stringifies a non-Error thrown value in the failure message", () => {
    const spy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "boom, not an Error instance";
    });
    try {
      parser.parseJson("{}");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("boom, not an Error instance");
    } finally {
      spy.mockRestore();
    }
  });

  it("truncates the snippet on invalid JSON to the first 500 characters", () => {
    const block = "{" + "x".repeat(600);
    try {
      parser.parseJson(block);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toBe(block.slice(0, 500));
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    expect(parser.validate({ value: "ok" }, schema)).toEqual({ value: "ok" });
  });

  it("throws OutputParseError listing the schema issues when validation fails", () => {
    try {
      parser.validate({ value: 42 }, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("value:");
      expect(e.rawOutput).toBe(JSON.stringify({ value: 42 }).slice(0, 500));
    }
  });

  it("includes every issue path when multiple fields fail validation", () => {
    const multiSchema = z.object({ a: z.string(), b: z.number() });
    try {
      multiSchema.parse; // no-op to keep reference alive
      parser.validate({ a: 1, b: "nope" }, multiSchema);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("a:");
      expect(e.message).toContain("b:");
    }
  });
});

describe("OutputParser.parse() (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a full structured output block", () => {
    const raw = `Some preamble.\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}\n`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("no delimiters here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a well-formed but non-conforming block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":123}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
