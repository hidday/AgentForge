import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts the text between the begin and end delimiters", () => {
    const raw = "preamble\nBEGIN_STRUCTURED_OUTPUT\n{\"a\":1}\nEND_STRUCTURED_OUTPUT\ntrailer";
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the last BEGIN delimiter when there are multiple (e.g. echoed prompt)", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "stale block that should be ignored",
      "END_STRUCTURED_OUTPUT",
      "some commentary",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":2}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":2}');
  });

  it("throws OutputParseError when the BEGIN delimiter is missing", () => {
    expect(() => parser.extractStructuredBlock("no markers here")).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock("no markers here");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("BEGIN_STRUCTURED_OUTPUT");
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{\"a\":1} no closing marker";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("END_STRUCTURED_OUTPUT");
      expect((err as OutputParseError).rawOutput).toContain("BEGIN_STRUCTURED_OUTPUT");
    }
  });

  it("includes only the tail 500 chars of raw output in the error when BEGIN is missing", () => {
    const raw = "x".repeat(600);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with a message and snippet on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe("{not valid json");
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns parsed data when schema validation succeeds", () => {
    const data = { success: true, stage: "planner" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each validation issue when schema fails", () => {
    const data = { success: "not-a-bool", stage: "wrong-stage" };
    try {
      parser.validate(data, schema);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const message = (err as OutputParseError).message;
      expect(message).toContain("schema validation");
      expect(message).toContain("success");
      expect(message).toContain("stage");
      expect((err as OutputParseError).rawOutput).toContain("not-a-bool");
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed block", () => {
    const raw = 'chatter\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner"}\nEND_STRUCTURED_OUTPUT';
    expect(parser.parse(raw, schema)).toEqual({ success: true, stage: "planner" });
  });

  it("propagates the delimiter error when no structured block is present", () => {
    expect(() => parser.parse("nothing to see here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\nnot json at all\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a well-formed but invalid block", () => {
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"executor"}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/schema validation/);
  });
});
