import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({ value: z.string() });

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts the trimmed JSON between the last BEGIN and the following END delimiter", () => {
    const parser = new OutputParser();
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n  {"value":"ok"}  \nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
  });

  it("uses the LAST BEGIN delimiter when multiple are present", () => {
    const parser = new OutputParser();
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"value":"stale"}',
      "END_STRUCTURED_OUTPUT",
      "more chatter",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"value":"fresh"}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"fresh"}');
  });

  it("throws OutputParseError with a tail snippet when the BEGIN delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("BEGIN_STRUCTURED_OUTPUT");
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"value":"ok"}`;
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("END_STRUCTURED_OUTPUT");
      expect(e.rawOutput).toContain('{"value":"ok"}');
    }
  });
});

describe("OutputParser.parseJson", () => {
  it("parses a valid JSON block", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with the offending block (truncated) on invalid JSON", () => {
    const parser = new OutputParser();
    const bad = "{not valid json";
    try {
      parser.parseJson(bad);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(bad.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    expect(parser.validate({ value: "ok" }, schema)).toEqual({ value: "ok" });
  });

  it("throws OutputParseError listing the validation issues on schema mismatch", () => {
    const parser = new OutputParser();
    try {
      parser.validate({ value: 123 }, schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("value");
      expect(e.rawOutput).toBe(JSON.stringify({ value: 123 }).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  it("extracts, parses, and validates a full structured output block", () => {
    const parser = new OutputParser();
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n{"value":"ok"}\nEND_STRUCTURED_OUTPUT`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("nothing here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const parser = new OutputParser();
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{broken\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a well-formed but invalid block", () => {
    const parser = new OutputParser();
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"value":42}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
