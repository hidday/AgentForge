import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the begin/end delimiters", () => {
    const raw = `some preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  { "ok": true }  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{ "ok": true }');
  });

  it("uses the LAST begin delimiter when there are multiple", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nold\n${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\nnew\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe("new");
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect((err as OutputParseError).rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when the begin delimiter is present but the end delimiter is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{ "ok": true }`;
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("stringifies a non-Error throwable from JSON.parse into the error message", () => {
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "not-an-error-object";
    });
    try {
      parser.parseJson("{}");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("not-an-error-object");
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("throws OutputParseError with the offending text on invalid JSON", () => {
    try {
      parser.parseJson("{not json");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe("{not json");
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();
  const schema = z.object({ name: z.string(), age: z.number() });

  it("returns the parsed data when it matches the schema", () => {
    const result = parser.validate({ name: "a", age: 1 }, schema);
    expect(result).toEqual({ name: "a", age: 1 });
  });

  it("throws OutputParseError listing each validation issue by path", () => {
    try {
      parser.validate({ name: 1, age: "old" }, schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const message = (err as OutputParseError).message;
      expect(message).toContain("Structured output failed schema validation");
      expect(message).toContain("name:");
      expect(message).toContain("age:");
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();
  const schema = z.object({ ok: z.boolean() });

  it("extracts, parses, and validates a well-formed structured output block", () => {
    const raw = `log line\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok": true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true });
  });

  it("propagates the extraction error when delimiters are missing", () => {
    expect(() => parser.parse("no delimiters", schema)).toThrow(OutputParseError);
  });

  it("propagates the validation error when the payload doesn't match the schema", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok": "not-a-boolean"}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
