import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ foo: z.string() });

function wrap(json: string): string {
  return `some preamble text\n${STRUCTURED_OUTPUT_BEGIN}\n${json}\n${STRUCTURED_OUTPUT_END}\nsome trailer text`;
}

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts and trims the text between the begin/end delimiters", () => {
    const parser = new OutputParser();
    const raw = wrap('{"foo":"bar"}');
    expect(parser.extractStructuredBlock(raw)).toBe('{"foo":"bar"}');
  });

  it("uses the LAST begin delimiter when there are multiple (e.g. retries in the transcript)", () => {
    const parser = new OutputParser();
    const raw =
      `${STRUCTURED_OUTPUT_BEGIN}\n{"foo":"stale"}\n${STRUCTURED_OUTPUT_END}\n` +
      `${STRUCTURED_OUTPUT_BEGIN}\n{"foo":"fresh"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"foo":"fresh"}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const parser = new OutputParser();
    expect(() => parser.extractStructuredBlock("no delimiters here")).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock("no delimiters here");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect((err as OutputParseError).rawOutput).toBe("no delimiters here");
    }
  });

  it("includes only the last 500 chars of raw output when the begin delimiter is missing from a long transcript", () => {
    const parser = new OutputParser();
    const raw = "x".repeat(1000);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toBe("x".repeat(500));
    }
  });

  it("throws OutputParseError when the begin delimiter is present but the end delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"foo":"bar"}`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });

  it("only searches for the end delimiter after the begin delimiter (does not match an end that precedes begin)", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"foo":"bar"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"foo":"bar"}');
  });
});

describe("OutputParser.parseJson", () => {
  it("parses a valid JSON block", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"foo":"bar"}')).toEqual({ foo: "bar" });
  });

  it("throws OutputParseError with the invalid-JSON message and a truncated snippet on malformed JSON", () => {
    const parser = new OutputParser();
    const bad = "{not valid json";
    try {
      parser.parseJson(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe(bad);
    }
  });

  it("truncates the raw snippet on a parse error to 500 chars", () => {
    const parser = new OutputParser();
    const bad = "{" + "x".repeat(1000);
    try {
      parser.parseJson(bad);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toBe(bad.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    expect(parser.validate({ foo: "bar" }, schema)).toEqual({ foo: "bar" });
  });

  it("throws OutputParseError listing each validation issue by path when the data does not match", () => {
    const parser = new OutputParser();
    try {
      parser.validate({ foo: 123 }, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Structured output failed schema validation");
      expect((err as OutputParseError).message).toContain("foo:");
    }
  });

  it("includes a truncated JSON snippet of the offending data in the error", () => {
    const parser = new OutputParser();
    try {
      parser.validate({ foo: 123, extra: "y".repeat(1000) }, schema);
      expect.unreachable();
    } catch (err) {
      const rawOutput = (err as OutputParseError).rawOutput ?? "";
      expect(rawOutput.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("OutputParser.parse (end to end)", () => {
  it("extracts, parses, and validates a well-formed structured output block", () => {
    const parser = new OutputParser();
    const raw = wrap('{"foo":"bar"}');
    expect(parser.parse(raw, schema)).toEqual({ foo: "bar" });
  });

  it("propagates the delimiter error when the block is missing", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("nothing to see here", schema)).toThrow(
      /Could not find/,
    );
  });

  it("propagates the JSON parse error when the block is malformed JSON", () => {
    const parser = new OutputParser();
    const raw = wrap("{not json");
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the parsed JSON does not match the schema", () => {
    const parser = new OutputParser();
    const raw = wrap('{"foo":123}');
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
