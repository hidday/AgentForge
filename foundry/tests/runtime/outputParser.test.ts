import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string() });

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts the JSON block between BEGIN/END delimiters, trimmed", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"value":"ok"}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
  });

  it("throws OutputParseError when the BEGIN delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = "just some plain text with no markers";

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

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const parser = new OutputParser();
    const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\nno end here`;

    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.rawOutput).toContain('{"value":"ok"}');
    }
  });

  it("uses the LAST occurrence of BEGIN when the delimiter appears more than once", () => {
    const parser = new OutputParser();
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      '{"value":"stale"}',
      STRUCTURED_OUTPUT_END,
      "more chatter",
      STRUCTURED_OUTPUT_BEGIN,
      '{"value":"fresh"}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"fresh"}');
  });
});

describe("OutputParser.parseJson", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with a snippet of the offending block on malformed JSON", () => {
    const parser = new OutputParser();
    const malformed = "{not valid json,,,";

    try {
      parser.parseJson(malformed);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(malformed.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    expect(parser.validate({ value: "ok" }, schema)).toEqual({ value: "ok" });
  });

  it("throws OutputParseError listing every issue path and message on schema mismatch", () => {
    const parser = new OutputParser();
    const badData = { value: 42, extra: true };

    try {
      parser.validate(badData, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("value");
      expect(e.rawOutput).toBe(JSON.stringify(badData).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  it("extracts, parses, and validates a well-formed structured block", () => {
    const parser = new OutputParser();
    const raw = `chat\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"done"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ value: "done" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("no structured output here", schema)).toThrow(OutputParseError);
  });
});
