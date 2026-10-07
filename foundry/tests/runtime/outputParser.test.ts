import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts and trims the block between BEGIN/END delimiters", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  { "a": 1 }  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{ "a": 1 }');
  });

  it("uses the LAST occurrence of BEGIN when it appears multiple times", () => {
    const raw =
      `${STRUCTURED_OUTPUT_BEGIN}\nold stale block\n${STRUCTURED_OUTPUT_END}\n` +
      `noise\n${STRUCTURED_OUTPUT_BEGIN}\n{"fresh":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"fresh":true}');
  });

  it("throws OutputParseError when BEGIN delimiter is missing", () => {
    const raw = "just some chatty text with no delimiters at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(`Could not find "${STRUCTURED_OUTPUT_BEGIN}"`);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("truncates rawOutput to the last 500 chars when BEGIN is missing from long output", () => {
    const raw = "x".repeat(900) + "[END_OF_INPUT]";
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
      expect(e.rawOutput).toContain("[END_OF_INPUT]");
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"unterminated": true}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain(`Found "${STRUCTURED_OUTPUT_BEGIN}"`);
      expect(e.message).toContain(`no matching "${STRUCTURED_OUTPUT_END}"`);
      expect(e.rawOutput).toContain('{"unterminated": true}');
    }
  });

  it("only searches for END after the matched BEGIN (not an earlier stray END)", () => {
    // A stray END before BEGIN must not satisfy indexOf's afterBegin search.
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and truncated block on invalid JSON", () => {
    const badBlock = "{not valid json,,,";
    try {
      parser.parseJson(badBlock);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON:");
      expect(e.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });

  it("truncates the raw block to the first 500 chars on failure", () => {
    const badBlock = "{" + "a".repeat(900);
    try {
      parser.parseJson(badBlock);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
      expect(e.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });

  it("stringifies a non-Error throw from JSON.parse", () => {
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "a raw string failure";
    });
    try {
      parser.parseJson("{}");
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toBe("Failed to parse JSON: a raw string failure");
    } finally {
      parseSpy.mockRestore();
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();
  const schema = z.object({ name: z.string(), age: z.number().int().positive() });

  it("returns the parsed data when it matches the schema", () => {
    const result = parser.validate({ name: "Ada", age: 30 }, schema);
    expect(result).toEqual({ name: "Ada", age: 30 });
  });

  it("throws OutputParseError listing every validation issue on failure", () => {
    const badData = { name: 42, age: -1 };
    try {
      parser.validate(badData, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation:");
      expect(e.message).toContain("name:");
      expect(e.message).toContain("age:");
      expect(e.rawOutput).toBe(JSON.stringify(badData).slice(0, 500));
    }
  });

  it("truncates the serialized data to 500 chars in the error", () => {
    const badData = { name: "x".repeat(900), age: -1 };
    try {
      parser.validate(badData, schema);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
    }
  });
});

describe("OutputParser.parse() (integration of extract -> parseJson -> validate)", () => {
  const parser = new OutputParser();
  const schema = z.object({ value: z.string() });

  it("extracts, parses and validates a full structured output envelope", () => {
    const raw = `Thinking...\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}\n`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
  });

  it("propagates the extractStructuredBlock error when no delimiters are present", () => {
    expect(() => parser.parse("no delimiters here", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the parseJson error when the block is not valid JSON", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the validate error when the parsed JSON fails the schema", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":123}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
