import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ ok: z.boolean(), name: z.string() });

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw, but it did not.");
}

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts the JSON block between the delimiters, trimmed", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"ok":true}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });

  it("uses the last begin delimiter when the model repeats itself", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":false}\n${STRUCTURED_OUTPUT_END}\nmore chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const err = captureError(() => parser.extractStructuredBlock("just plain text"));
    expect(err).toBeInstanceOf(OutputParseError);
    expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
  });

  it("throws OutputParseError when the end delimiter is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}`;
    const err = captureError(() => parser.extractStructuredBlock(raw));
    expect(err).toBeInstanceOf(OutputParseError);
    expect((err as OutputParseError).rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"ok":true}')).toEqual({ ok: true });
  });

  it("throws OutputParseError with the offending snippet on invalid JSON", () => {
    const err = captureError(() => parser.parseJson("{not json"));
    expect(err).toBeInstanceOf(OutputParseError);
    expect((err as OutputParseError).message).toContain("Failed to parse JSON");
    expect((err as OutputParseError).rawOutput).toBe("{not json");
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const result = parser.validate({ ok: true, name: "x" }, schema);
    expect(result).toEqual({ ok: true, name: "x" });
  });

  it("throws OutputParseError listing schema issues on mismatch", () => {
    const err = captureError(() => parser.validate({ ok: "nope" }, schema));
    expect(err).toBeInstanceOf(OutputParseError);
    const message = (err as OutputParseError).message;
    expect(message).toContain("Structured output failed schema validation");
    expect(message).toContain("ok:");
    expect(message).toContain("name:");
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a full structured output", () => {
    const raw = `blah\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ ok: true, name: "done" })}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true, name: "done" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("nothing here", schema)).toThrow(OutputParseError);
  });

  it("propagates the validation error when JSON parses but fails the schema", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ ok: true })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
