import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function wrap(json: unknown): string {
  return `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify(json)}\n${STRUCTURED_OUTPUT_END}\ntrailer`;
}

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the delimiters", () => {
    const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n  { "a": 1 }  \n${STRUCTURED_OUTPUT_END}\nmore noise`;
    expect(parser.extractStructuredBlock(raw)).toBe('{ "a": 1 }');
  });

  it("uses the LAST begin delimiter when it appears more than once", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      '{"stale": true}',
      STRUCTURED_OUTPUT_END,
      "some chatter in between",
      STRUCTURED_OUTPUT_BEGIN,
      '{"fresh": true}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"fresh": true}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const raw = "just some plain text with no markers at all";
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
    const raw = `text before\n${STRUCTURED_OUTPUT_BEGIN}\n{"incomplete": true`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_END);
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("only searches for the end delimiter after the begin delimiter (an end marker before begin is ignored)", () => {
    const raw = `${STRUCTURED_OUTPUT_END}\nstray end marker before begin\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok": true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok": true}');
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and truncated snippet for malformed JSON", () => {
    const block = "{ this is not valid json ";
    expect(() => parser.parseJson(block)).toThrow(OutputParseError);
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("truncates a very long malformed block to 500 characters in the error", () => {
    const block = "{" + "x".repeat(1000);
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput).toHaveLength(500);
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, stage: "planner", payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with per-field issue details when validation fails", () => {
    const data = { success: "not-a-boolean", stage: "planner", payload: {} };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("payload.value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("throws when a required field is missing entirely", () => {
    const data = { success: true, stage: "planner" };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
  });

  it("rejects a mismatched literal stage value", () => {
    const data = { success: true, stage: "executor", payload: { value: "x" } };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parse() (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = wrap({ success: true, stage: "planner", payload: { value: "hello" } });
    expect(parser.parse(raw, schema)).toEqual({
      success: true,
      stage: "planner",
      payload: { value: "hello" },
    });
  });

  it("propagates the delimiter error when no structured block is present", () => {
    expect(() => parser.parse("no delimiters here", schema)).toThrow(
      /Could not find/,
    );
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json at all\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a structurally valid but schema-invalid block", () => {
    const raw = wrap({ success: true, stage: "planner", payload: { value: 123 } });
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
