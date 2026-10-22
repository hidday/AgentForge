import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string(), count: z.number() });

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts the JSON block between the begin/end delimiters", () => {
    const raw = `chatter before\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok","count":1}\n${STRUCTURED_OUTPUT_END}\ntrailing`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok","count":1}');
  });

  it("uses the LAST begin delimiter when multiple are present", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      "stale",
      STRUCTURED_OUTPUT_END,
      "more chatter",
      STRUCTURED_OUTPUT_BEGIN,
      '{"value":"fresh","count":2}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"fresh","count":2}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    expect(() => parser.extractStructuredBlock("no delimiters here")).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock("no delimiters here");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("throws OutputParseError when the end delimiter is missing after begin", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });

  it("includes only the tail of very long unparseable output in the error context", () => {
    const longRaw = "x".repeat(10_000);
    try {
      parser.extractStructuredBlock(longRaw);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with a snippet of the bad block on invalid JSON", () => {
    try {
      parser.parseJson("{not json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).rawOutput).toContain("{not json");
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { value: "ok", count: 1 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing the failing path(s) on schema mismatch", () => {
    try {
      parser.validate({ value: "ok", count: "not-a-number" }, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("count");
    }
  });
});

describe("OutputParser.parse()", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a full structured-output payload end to end", () => {
    const raw = `thinking...\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok","count":3}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok", count: 3 });
  });

  it("propagates the OutputParseError from an earlier stage (missing delimiter)", () => {
    expect(() => parser.parse("no structured output", schema)).toThrow(OutputParseError);
  });

  it("propagates the OutputParseError from schema validation failure", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok","count":"bad"}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
