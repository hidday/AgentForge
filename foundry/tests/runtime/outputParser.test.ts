import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts and trims the text between BEGIN and END delimiters", () => {
    const parser = new OutputParser();
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n  { "a": 1 }  \nEND_STRUCTURED_OUTPUT\ntrailer`;

    expect(parser.extractStructuredBlock(raw)).toBe('{ "a": 1 }');
  });

  it("uses the LAST BEGIN delimiter when multiple are present", () => {
    const parser = new OutputParser();
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"first, stale"}',
      "END_STRUCTURED_OUTPUT",
      "some retry chatter",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"second, final"}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":"second, final"}');
  });

  it("throws OutputParseError when the BEGIN delimiter is missing entirely", () => {
    const parser = new OutputParser();
    const raw = "just plain chatty text with no delimiters";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT" delimiter in output');
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const parser = new OutputParser();
    const raw = "noise\nBEGIN_STRUCTURED_OUTPUT\n{\"a\":1}\nno end delimiter here";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toBe(
        'Found "BEGIN_STRUCTURED_OUTPUT" but no matching "END_STRUCTURED_OUTPUT" delimiter',
      );
      expect(e.rawOutput).toContain('{"a":1}');
    }
  });
});

describe("OutputParser.parseJson", () => {
  it("parses a valid JSON block", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"x":1,"y":[1,2,3]}')).toEqual({ x: 1, y: [1, 2, 3] });
  });

  it("throws OutputParseError with the underlying message and a truncated block snippet on invalid JSON", () => {
    const parser = new OutputParser();
    const badBlock = "{not valid json at all";

    expect(() => parser.parseJson(badBlock)).toThrow(OutputParseError);
    try {
      parser.parseJson(badBlock);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON:");
      expect(e.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });

  it("truncates the snippet for a long invalid block to 500 chars", () => {
    const parser = new OutputParser();
    const badBlock = "{" + "x".repeat(900);

    try {
      parser.parseJson(badBlock);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
      expect(e.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { success: true, stage: "planner", payload: { value: "ok" } };

    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each schema validation issue by path and message", () => {
    const parser = new OutputParser();
    const badData = { success: "not-a-boolean", stage: "planner", payload: { value: 123 } };

    expect(() => parser.validate(badData, schema)).toThrow(OutputParseError);
    try {
      parser.validate(badData, schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation:");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("payload.value:");
      expect(e.rawOutput).toBe(JSON.stringify(badData).slice(0, 500));
    }
  });

  it("rejects data for the wrong discriminant/stage", () => {
    const parser = new OutputParser();
    const badData = { success: true, stage: "executor", payload: { value: "x" } };

    expect(() => parser.validate(badData, schema)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parse — end to end", () => {
  it("extracts, parses, and validates a full structured output block", () => {
    const parser = new OutputParser();
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "done" },
    })}\nEND_STRUCTURED_OUTPUT\n`;

    expect(parser.parse(raw, schema)).toEqual({
      success: true,
      stage: "planner",
      payload: { value: "done" },
    });
  });

  it("propagates OutputParseError from extraction when delimiters are absent", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("no delimiters here", schema)).toThrow(OutputParseError);
  });

  it("propagates OutputParseError from JSON parsing when the block is malformed", () => {
    const parser = new OutputParser();
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{not json\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });

  it("propagates OutputParseError from schema validation when the JSON is well-formed but invalid", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({ wrong: "shape" })}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
