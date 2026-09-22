import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the text between the begin/end delimiters", () => {
    const raw = `chatter before\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("throws OutputParseError with the raw tail when the begin delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError with a snippet from the begin marker when the end delimiter is missing", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno end marker here`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      const beginIdx = raw.indexOf(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
    }
  });

  it("uses the LAST begin marker and the END that follows it when the model repeats the block", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      '{"a":"first"}',
      STRUCTURED_OUTPUT_END,
      "some retry commentary",
      STRUCTURED_OUTPUT_BEGIN,
      '{"a":"second"}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":"second"}');
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"x":1,"y":[1,2,3]}')).toEqual({ x: 1, y: [1, 2, 3] });
  });

  it("throws OutputParseError with a snippet of the offending block on invalid JSON", () => {
    const block = "{not valid json";
    try {
      parser.parseJson(block);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("truncates a very long invalid block to 500 characters in the error", () => {
    const block = "{" + "x".repeat(900);
    try {
      parser.parseJson(block);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toBe(block.slice(0, 500));
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, stage: "planner", payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with formatted per-field issues when validation fails", () => {
    const data = { success: "not-a-bool", stage: "planner", payload: { value: 5 } };
    try {
      parser.validate(data, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("payload.value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("rejects when the stage literal does not match", () => {
    const data = { success: true, stage: "executor", payload: { value: "x" } };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "hello" },
    })}\n${STRUCTURED_OUTPUT_END}\n`;

    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, stage: "planner", payload: { value: "hello" } });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("just plain text", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{bad json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a structurally invalid payload", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ success: true })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
