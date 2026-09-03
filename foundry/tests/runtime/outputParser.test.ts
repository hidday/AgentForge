import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts the content between BEGIN/END markers, trimmed", () => {
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN marker when multiple structured blocks are present", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"first"}',
      "END_STRUCTURED_OUTPUT",
      "some chatter in between",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"second"}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":"second"}');
  });

  it("throws OutputParseError when the BEGIN delimiter is missing", () => {
    const raw = "just some plain text with no markers at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("BEGIN_STRUCTURED_OUTPUT");
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError on empty input (no delimiters found)", () => {
    expect(() => parser.extractStructuredBlock("")).toThrow(OutputParseError);
  });

  it("truncates rawOutput on the missing-BEGIN error to the last 500 chars", () => {
    const raw = "x".repeat(1000);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const raw = `noise\nBEGIN_STRUCTURED_OUTPUT\n{"a":1}\nno end marker here`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("END_STRUCTURED_OUTPUT");
      expect(e.message).toContain("no matching");
      // rawOutput should be the tail starting at BEGIN, capped at 500 chars.
      expect(e.rawOutput?.startsWith("BEGIN_STRUCTURED_OUTPUT")).toBe(true);
      expect(e.rawOutput!.length).toBeLessThanOrEqual(500);
    }
  });

  it("does not match an END that appears before BEGIN", () => {
    // END_STRUCTURED_OUTPUT appears once, but before the (last) BEGIN — the
    // search for END starts only after BEGIN's position, so this must fail.
    const raw = "END_STRUCTURED_OUTPUT\nBEGIN_STRUCTURED_OUTPUT\n{}";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(/no matching/);
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses a valid JSON object", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("parses valid JSON primitives", () => {
    expect(parser.parseJson("42")).toBe(42);
    expect(parser.parseJson('"hello"')).toBe("hello");
    expect(parser.parseJson("true")).toBe(true);
    expect(parser.parseJson("null")).toBe(null);
  });

  it("throws OutputParseError with a helpful message on malformed JSON", () => {
    try {
      parser.parseJson("{not valid json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe("{not valid json");
    }
  });

  it("throws on empty-string input", () => {
    expect(() => parser.parseJson("")).toThrow(OutputParseError);
  });

  it("truncates rawOutput on parse failure to the first 500 chars of the block", () => {
    const block = "{".repeat(1000); // invalid JSON, long
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();
  const schema = z.object({
    success: z.boolean(),
    payload: z.object({ value: z.string() }),
  });

  it("returns the parsed/validated data on success", () => {
    const data = { success: true, payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("applies schema transforms/defaults, returning result.data rather than the raw input", () => {
    const transformSchema = z.object({ n: z.string() }).transform((d) => ({ n: Number(d.n) }));
    expect(parser.validate({ n: "42" }, transformSchema)).toEqual({ n: 42 });
  });

  it("throws OutputParseError with per-field issue lines on validation failure", () => {
    const data = { success: "not-a-bool", payload: { value: 123 } };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("payload.value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("formats a root-level issue with an empty path segment", () => {
    // Passing a non-object where an object is expected produces a root-level
    // issue whose `path` array is empty, so path.join(".") === "".
    try {
      parser.validate("not-an-object", schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("\n  : ");
    }
  });

  it("truncates rawOutput on validation failure to 500 chars", () => {
    const data = { success: "nope", payload: { value: "x".repeat(1000) } };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toHaveLength(500);
    }
  });
});

describe("OutputParser.parse() — end-to-end", () => {
  const parser = new OutputParser();
  const schema = z.object({ ok: z.boolean() });

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"ok":true}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true });
  });

  it("propagates the extraction failure when no delimiters are present", () => {
    expect(() => parser.parse("no markers here", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse failure when the block is malformed", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{not json\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation failure when the parsed JSON doesn't match", () => {
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"ok":"yes"}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
