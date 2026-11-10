import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts the trimmed content between the begin/end delimiters", () => {
    const raw = "preamble\nBEGIN_STRUCTURED_OUTPUT\n  {\"a\":1}  \nEND_STRUCTURED_OUTPUT\ntrailer";
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST begin delimiter when the marker appears more than once", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "{\"old\":true}",
      "END_STRUCTURED_OUTPUT",
      "some text in between",
      "BEGIN_STRUCTURED_OUTPUT",
      "{\"old\":false}",
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"old":false}');
  });

  it("throws OutputParseError when the begin delimiter is missing entirely", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Could not find");
      expect(e.message).toContain("BEGIN_STRUCTURED_OUTPUT");
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("includes only the last 500 chars of raw output in the error when begin delimiter is missing", () => {
    const raw = "x".repeat(900) + "[TAIL]";
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toContain("[TAIL]");
    }
  });

  it("throws OutputParseError when begin delimiter is present but end delimiter is missing", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{\"a\":1}\nno end marker here";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Found");
      expect(e.message).toContain("no matching");
      expect(e.rawOutput).toContain('{"a":1}');
    }
  });

  it("does not match an END delimiter that appears before the begin delimiter", () => {
    // END_STRUCTURED_OUTPUT appears before BEGIN, so it must be ignored and
    // treated as "no end delimiter found after begin".
    const raw = "END_STRUCTURED_OUTPUT\nBEGIN_STRUCTURED_OUTPUT\n{\"a\":1}\nstill no end";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"x":1,"y":[1,2,3]}')).toEqual({ x: 1, y: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and a snippet of the offending block on invalid JSON", () => {
    const block = "{ not valid json ";
    expect(() => parser.parseJson(block)).toThrow(OutputParseError);
    try {
      parser.parseJson(block);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("truncates the raw-output snippet on the error to the first 500 chars of a long invalid block", () => {
    const block = "{" + "x".repeat(900);
    try {
      parser.parseJson(block);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, value: "ok" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each path/message issue when validation fails", () => {
    const data = { success: "not-a-boolean", value: 42 };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("truncates the raw-output snippet to 500 chars for a large invalid payload", () => {
    const badData = { success: 1, value: "x".repeat(900) };
    try {
      parser.validate(badData, schema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      value: "done",
    })}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("plain text, no markers", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error when the block is malformed JSON", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{not json}\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });

  it("propagates the schema validation error when JSON is valid but doesn't match the schema", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({ wrong: "shape" })}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
