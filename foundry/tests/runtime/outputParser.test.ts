import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the begin/end markers", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST begin marker when there are multiple (CLI retries/duplicate blocks)", () => {
    const raw = [
      `${STRUCTURED_OUTPUT_BEGIN}`,
      `{"first":true}`,
      `${STRUCTURED_OUTPUT_END}`,
      `${STRUCTURED_OUTPUT_BEGIN}`,
      `{"second":true}`,
      `${STRUCTURED_OUTPUT_END}`,
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"second":true}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    expect(() => parser.extractStructuredBlock("just plain text, no markers")).toThrow(
      OutputParseError,
    );
  });

  it("includes only the tail (last 500 chars) of the raw output when the begin delimiter is missing", () => {
    const raw = "x".repeat(600) + "[END_MARKER]";
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput).toHaveLength(500);
      expect(parseErr.rawOutput).toContain("[END_MARKER]");
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("throws OutputParseError when the begin delimiter is present but the end delimiter is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno end here`;
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect((err as Error).message).toContain(STRUCTURED_OUTPUT_END);
      expect(parseErr.rawOutput).toContain('{"a":1}');
    }
  });

  it("does not match an END marker that appears before the chosen BEGIN marker", () => {
    // END_STRUCTURED_OUTPUT appears textually before the real BEGIN marker;
    // indexOf starts searching from just after BEGIN, so it must be ignored.
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and a truncated rawOutput on invalid JSON", () => {
    const block = "{not json" + "z".repeat(600);
    try {
      parser.parseJson(block);
      throw new Error("expected parseJson to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toHaveLength(500);
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("falls back to String(err) when JSON.parse throws a non-Error value", () => {
    const spy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "not an Error instance";
    });
    try {
      parser.parseJson('{"a":1}');
      throw new Error("expected parseJson to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("not an Error instance");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();
  const schema = z.object({ name: z.string(), age: z.number() });

  it("returns the parsed data when it matches the schema", () => {
    const result = parser.validate({ name: "a", age: 1 }, schema);
    expect(result).toEqual({ name: "a", age: 1 });
  });

  it("throws OutputParseError listing every validation issue when the schema does not match", () => {
    try {
      parser.validate({ name: 1, age: "old" }, schema);
      throw new Error("expected validate to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation");
      expect(parseErr.message).toContain("name:");
      expect(parseErr.message).toContain("age:");
      expect(parseErr.rawOutput).toBe(JSON.stringify({ name: 1, age: "old" }).slice(0, 500));
    }
  });
});

describe("OutputParser.parse() — end-to-end", () => {
  const parser = new OutputParser();
  const schema = z.object({ ok: z.boolean() });

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}\nmore chatter`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true });
  });

  it("propagates the extraction failure when no structured block is present", () => {
    expect(() => parser.parse("nothing structured here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse failure for a malformed block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json at all\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation failure for a structurally valid but wrong-shaped block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":"not-a-boolean"}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
