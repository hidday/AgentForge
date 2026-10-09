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
  it("throws OutputParseError when BEGIN delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = "just some chatty text with no delimiters";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT"');
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when END delimiter is missing after BEGIN", () => {
    const parser = new OutputParser();
    const raw = "preamble\nBEGIN_STRUCTURED_OUTPUT\n{not closed";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain('no matching "END_STRUCTURED_OUTPUT"');
      expect(e.rawOutput).toContain("{not closed");
    }
  });

  it("extracts and trims the block between delimiters", () => {
    const parser = new OutputParser();
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n  { "a": 1 }  \nEND_STRUCTURED_OUTPUT\ntrailer`;

    const block = parser.extractStructuredBlock(raw);
    expect(block).toBe('{ "a": 1 }');
  });

  it("uses the LAST BEGIN delimiter when multiple are present", () => {
    const parser = new OutputParser();
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "stale",
      "END_STRUCTURED_OUTPUT",
      "more chatter",
      "BEGIN_STRUCTURED_OUTPUT",
      "fresh",
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    const block = parser.extractStructuredBlock(raw);
    expect(block).toBe("fresh");
  });
});

describe("OutputParser.parseJson", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with a snippet of the bad block on invalid JSON", () => {
    const parser = new OutputParser();
    const bad = "{not valid json";

    expect(() => parser.parseJson(bad)).toThrow(OutputParseError);
    try {
      parser.parseJson(bad);
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(bad.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { success: true, stage: "planner", payload: { value: "ok" } };

    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing issues when schema validation fails", () => {
    const parser = new OutputParser();
    const data = { success: "nope", stage: "planner" };

    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("success:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (integration)", () => {
  it("extracts, parses, and validates a full structured output block", () => {
    const parser = new OutputParser();
    const raw = `notes\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT`;

    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, stage: "planner", payload: { value: "ok" } });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("no delimiters here", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const parser = new OutputParser();
    const raw = "BEGIN_STRUCTURED_OUTPUT\nnot json\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the JSON doesn't match", () => {
    const parser = new OutputParser();
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"success":true}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
