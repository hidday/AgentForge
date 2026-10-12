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
  const parser = new OutputParser();

  it("extracts the trimmed text between the last BEGIN marker and the following END marker", () => {
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN marker when the delimiter appears more than once", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "stale block",
      "END_STRUCTURED_OUTPUT",
      "some chatter in between",
      "BEGIN_STRUCTURED_OUTPUT",
      "fresh block",
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe("fresh block");
  });

  it("throws OutputParseError with a tail snippet when the BEGIN delimiter is missing entirely", () => {
    const raw = "just plain CLI chatter with no markers at all";

    let caught: unknown;
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutputParseError);
    const err = caught as OutputParseError;
    expect(err.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT" delimiter');
    expect(err.rawOutput).toBe(raw.slice(-500));
  });

  it("truncates the raw output snippet to the last 500 characters when BEGIN is missing", () => {
    const raw = "x".repeat(600) + "TAIL_MARKER";

    let caught: unknown;
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      caught = err;
    }

    const err = caught as OutputParseError;
    expect(err.rawOutput).toHaveLength(500);
    expect(err.rawOutput).toBe(raw.slice(-500));
    expect(err.rawOutput?.endsWith("TAIL_MARKER")).toBe(true);
  });

  it("throws OutputParseError when BEGIN is present but there is no matching END delimiter", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"unterminated": true}`;

    let caught: unknown;
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutputParseError);
    const err = caught as OutputParseError;
    expect(err.message).toContain('Found "BEGIN_STRUCTURED_OUTPUT"');
    expect(err.message).toContain('no matching "END_STRUCTURED_OUTPUT"');
    expect(err.rawOutput).toContain('"unterminated": true');
  });

  it("only searches for END after the matched BEGIN occurrence, not before it", () => {
    // An END marker earlier in the string (before the last BEGIN) must not satisfy the search.
    const raw = `END_STRUCTURED_OUTPUT\nBEGIN_STRUCTURED_OUTPUT\n{"ok":true}`;

    let caught: unknown;
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutputParseError);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block into its value", () => {
    expect(parser.parseJson('{"a":1,"b":[true,null]}')).toEqual({ a: 1, b: [true, null] });
  });

  it("throws OutputParseError with the original error message and a snippet of the block on malformed JSON", () => {
    const block = "{not valid json";

    let caught: unknown;
    try {
      parser.parseJson(block);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutputParseError);
    const err = caught as OutputParseError;
    expect(err.message).toContain("Failed to parse JSON:");
    expect(err.rawOutput).toBe(block.slice(0, 500));
  });

  it("truncates the block snippet to the first 500 characters on malformed JSON", () => {
    const block = "{" + "x".repeat(600);

    let caught: unknown;
    try {
      parser.parseJson(block);
    } catch (err) {
      caught = err;
    }

    const err = caught as OutputParseError;
    expect(err.rawOutput).toHaveLength(500);
    expect(err.rawOutput).toBe(block.slice(0, 500));
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, stage: "planner", payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each path and message when schema validation fails", () => {
    const data = { success: "not-a-boolean", stage: "planner", payload: { value: 42 } };

    let caught: unknown;
    try {
      parser.validate(data, schema);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutputParseError);
    const err = caught as OutputParseError;
    expect(err.message).toContain("Structured output failed schema validation:");
    expect(err.message).toContain("success:");
    expect(err.message).toContain("payload.value:");
    expect(err.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
  });

  it("rejects data for the wrong discriminant stage", () => {
    const data = { success: true, stage: "executor", payload: { value: "ok" } };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `some CLI preamble\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("no markers here", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse error when the block content is malformed", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{broken\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the validation error when the parsed JSON does not match the schema", () => {
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner"}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
