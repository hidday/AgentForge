import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between BEGIN/END delimiters", () => {
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN delimiter when the marker appears more than once", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"first-and-stale"}',
      "END_STRUCTURED_OUTPUT",
      "some retry chatter",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"second-and-final"}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":"second-and-final"}');
  });

  it("throws OutputParseError with a tail snippet when no BEGIN delimiter is present", () => {
    const raw = "x".repeat(600) + "[END_OF_RAW]";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT"');
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
      expect(parseErr.rawOutput).toContain("[END_OF_RAW]");
    }
  });

  it("throws OutputParseError when BEGIN is found but no matching END delimiter exists", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"a":1} truncated because the stream died`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain('Found "BEGIN_STRUCTURED_OUTPUT"');
      expect(parseErr.message).toContain('no matching "END_STRUCTURED_OUTPUT"');
      expect(parseErr.rawOutput).toContain("truncated because the stream died");
    }
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block into its value", () => {
    expect(parser.parseJson('{"success":true,"value":"ok"}')).toEqual({
      success: true,
      value: "ok",
    });
  });

  it("throws OutputParseError with the offending block on malformed JSON", () => {
    const block = "{not valid json";
    try {
      parser.parseJson(block);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();

  it("returns the typed, validated data when it matches the schema", () => {
    const data = { success: true, value: "ok" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing path+message issues when schema validation fails", () => {
    const data = { success: "not-a-boolean", value: 42 };
    try {
      parser.validate(data, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("failed schema validation");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse() (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses and validates a full structured-output payload", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"value":"done"}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
  });

  it("propagates the delimiter error when the raw output has no structured block", () => {
    expect(() => parser.parse("just plain text, no markers", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\nnot: json\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the parsed JSON doesn't match the schema", () => {
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"success":"nope"}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
