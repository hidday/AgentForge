import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the begin/end delimiters", () => {
    const raw = `chatter before\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailing`;

    const block = parser.extractStructuredBlock(raw);

    expect(block).toBe('{"a":1}');
  });

  it("uses the LAST begin delimiter when the marker appears more than once", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      "first-attempt-garbage",
      STRUCTURED_OUTPUT_END,
      "some retry chatter",
      STRUCTURED_OUTPUT_BEGIN,
      '{"final":true}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    const block = parser.extractStructuredBlock(raw);

    expect(block).toBe('{"final":true}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const raw = "no structured output markers here at all";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when the begin delimiter is present but the end delimiter is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno closing marker`;

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_END);
      expect(parseErr.rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("only searches for the end delimiter after the begin delimiter (does not match an end marker that precedes begin)", () => {
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\n${STRUCTURED_OUTPUT_END}`;

    const block = parser.extractStructuredBlock(raw);

    expect(block).toBe('{"a":1}');
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("throws OutputParseError with a message and truncated snippet on invalid JSON", () => {
    const badBlock = "{not valid json";

    expect(() => parser.parseJson(badBlock)).toThrow(OutputParseError);
    try {
      parser.parseJson(badBlock);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });

  it("truncates a long invalid block to 500 characters in rawOutput", () => {
    const badBlock = "{" + "x".repeat(1000);

    try {
      parser.parseJson(badBlock);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, value: "ok" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each failing path and message on schema mismatch", () => {
    const data = { success: "not-a-boolean", value: 123 };

    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (integration of all three steps)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block end to end", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ success: true, value: "done" })}\n${STRUCTURED_OUTPUT_END}`;

    expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("plain text, no markers", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });

  it("propagates the schema validation error when the JSON doesn't match the schema", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ success: true })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
