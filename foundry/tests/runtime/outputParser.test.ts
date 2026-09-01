import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string(), count: z.number() });

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts the trimmed block between begin and end delimiters", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST begin delimiter when multiple are present", () => {
    const raw =
      `${STRUCTURED_OUTPUT_BEGIN}\nfirst-stale-block\n${STRUCTURED_OUTPUT_END}\n` +
      `some chatter\n` +
      `${STRUCTURED_OUTPUT_BEGIN}\nsecond-real-block\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe("second-real-block");
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("includes only the tail (last 500 chars) of raw output in the error when begin is missing", () => {
    const raw = "x".repeat(600) + "[TAIL]";
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toContain("[TAIL]");
    }
  });

  it("throws OutputParseError when begin is present but end delimiter is missing", () => {
    const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno end here`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.message).toContain("no matching");
    }
  });

  it("truncates the rawOutput slice to 500 chars from beginIdx when end is missing", () => {
    const raw = STRUCTURED_OUTPUT_BEGIN + "y".repeat(900);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput?.startsWith(STRUCTURED_OUTPUT_BEGIN)).toBe(true);
    }
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("throws OutputParseError with the underlying message on invalid JSON", () => {
    expect(() => parser.parseJson("{not valid json")).toThrow(OutputParseError);
    try {
      parser.parseJson("{not valid json");
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe("{not valid json");
    }
  });

  it("truncates rawOutput on the error to the first 500 chars of the block", () => {
    const badBlock = "{" + "z".repeat(900);
    try {
      parser.parseJson(badBlock);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { value: "hi", count: 3 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with per-field issues when schema validation fails", () => {
    const data = { value: 42, count: "nope" };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("value:");
      expect(e.message).toContain("count:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a full structured output payload", () => {
    const raw = `Some model chatter.\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({
      value: "ok",
      count: 7,
    })}\n${STRUCTURED_OUTPUT_END}\n`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok", count: 7 });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("plain text, no delimiters", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot-json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when JSON is valid but shape is wrong", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ value: 1 })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/schema validation/);
  });
});
