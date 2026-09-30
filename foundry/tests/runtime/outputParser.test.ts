import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims content between the begin/end delimiters", () => {
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST begin delimiter when multiple are present", () => {
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

  it("throws OutputParseError with a tail snippet when BEGIN delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT" delimiter');
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("takes the tail-500 of raw output when BEGIN is missing and raw is very long", () => {
    const raw = "x".repeat(1000) + "[TAIL]";
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toContain("[TAIL]");
    }
  });

  it("throws OutputParseError when BEGIN is found but END is missing", () => {
    const raw = "chatter\nBEGIN_STRUCTURED_OUTPUT\n{unterminated";
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain('Found "BEGIN_STRUCTURED_OUTPUT"');
      expect(e.message).toContain('no matching "END_STRUCTURED_OUTPUT"');
      expect(e.rawOutput).toContain("{unterminated");
    }
  });

  it("does not match an END delimiter that appears before BEGIN", () => {
    const raw = "END_STRUCTURED_OUTPUT\nBEGIN_STRUCTURED_OUTPUT\n{\"a\":1}";
    // No END after the begin index -> should throw the "no matching END" error.
    expect(() => parser.extractStructuredBlock(raw)).toThrow(/no matching/);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with the offending block on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toContain("{not valid json");
    }
  });

  it("stringifies a non-Error value thrown by the JSON parser", () => {
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "raw non-error failure";
    });
    try {
      parser.parseJson("{}");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toBe("Failed to parse JSON: raw non-error failure");
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("truncates a very long invalid block to 500 chars in rawOutput", () => {
    const block = "{" + "x".repeat(1000);
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();
  const schema = z.object({ name: z.string(), age: z.number().min(0) });

  it("returns the parsed data when it matches the schema", () => {
    const data = { name: "Ada", age: 30 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError describing each validation issue", () => {
    const data = { name: 42, age: -5 };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("name:");
      expect(e.message).toContain("age:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (integration)", () => {
  const parser = new OutputParser();
  const schema = z.object({ ok: z.boolean() });

  it("extracts, parses, and validates a full structured output block", () => {
    const raw = `some model chatter\nBEGIN_STRUCTURED_OUTPUT\n{"ok":true}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true });
  });

  it("propagates the extraction error when no delimiter is present", () => {
    expect(() => parser.parse("nothing to see here", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse error when the block is malformed", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{ok: true\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the JSON doesn't match the schema", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"ok":"not-a-boolean"}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
