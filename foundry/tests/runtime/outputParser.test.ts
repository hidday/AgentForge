import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({ ok: z.boolean(), value: z.string() });

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts the trimmed content between the delimiters", () => {
    const raw = `noise before\nBEGIN_STRUCTURED_OUTPUT\n  {"ok":true}  \nEND_STRUCTURED_OUTPUT\ntrailing`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });

  it("uses the LAST BEGIN delimiter when the output contains multiple blocks", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "first",
      "END_STRUCTURED_OUTPUT",
      "BEGIN_STRUCTURED_OUTPUT",
      "second",
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe("second");
  });

  it("throws OutputParseError with the output tail when the BEGIN delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("BEGIN_STRUCTURED_OUTPUT");
      expect((err as OutputParseError).rawOutput).toBe(raw);
    }
  });

  it("throws OutputParseError when BEGIN is found but END is missing", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{not closed";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).message).toContain("no matching");
      expect((err as OutputParseError).rawOutput).toContain("{not closed");
    }
  });

  it("truncates a very long tail to 500 chars when the BEGIN delimiter is missing", () => {
    const raw = "X".repeat(1000);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toHaveLength(500);
    }
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with the JSON error message and block snippet on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe("{not valid json");
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { ok: true, value: "hi" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each validation issue by path", () => {
    try {
      parser.validate({ ok: "not-a-boolean", value: 42 }, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const message = (err as OutputParseError).message;
      expect(message).toContain("Structured output failed schema validation");
      expect(message).toContain("ok:");
      expect(message).toContain("value:");
    }
  });

  it("includes a JSON snippet of the offending data, truncated to 500 chars", () => {
    const bigValue = "Y".repeat(1000);
    try {
      parser.validate({ ok: "nope", value: bigValue }, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toHaveLength(500);
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"ok":true,"value":"done"}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true, value: "done" });
  });

  it("propagates the extraction error when delimiters are missing", () => {
    expect(() => parser.parse("no structure here", schema)).toThrow(/BEGIN_STRUCTURED_OUTPUT/);
  });

  it("propagates the JSON error when the block isn't valid JSON", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\nnot json\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the parsed data doesn't match", () => {
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"ok":"nope"}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
