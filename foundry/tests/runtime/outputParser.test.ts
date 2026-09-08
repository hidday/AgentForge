import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string(), count: z.number() });

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("throws OutputParseError when the BEGIN delimiter is missing", () => {
    expect(() => parser.extractStructuredBlock("just some plain text output")).toThrow(
      OutputParseError,
    );
    try {
      parser.extractStructuredBlock("just some plain text output");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe("just some plain text output");
    }
  });

  it("includes only the tail 500 chars of raw output when BEGIN delimiter is missing from long output", () => {
    const longText = "z".repeat(700) + "[END_MARKER]";
    try {
      parser.extractStructuredBlock(longText);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toContain("[END_MARKER]");
    }
  });

  it("throws OutputParseError when BEGIN is found but END is missing", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"x"}`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("extracts and trims the block between BEGIN and END delimiters", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n  {"value":"x"}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    const block = parser.extractStructuredBlock(raw);
    expect(block).toBe('{"value":"x"}');
  });

  it("uses the LAST BEGIN delimiter when multiple are present", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      '{"value":"stale"}',
      STRUCTURED_OUTPUT_END,
      "some more chatter",
      STRUCTURED_OUTPUT_BEGIN,
      '{"value":"fresh"}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");
    const block = parser.extractStructuredBlock(raw);
    expect(block).toBe('{"value":"fresh"}');
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with the underlying message on invalid JSON", () => {
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

  it("truncates the raw block reported in the error to 500 chars", () => {
    const longInvalid = "{" + "x".repeat(700);
    try {
      parser.parseJson(longInvalid);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns parsed data when schema validation succeeds", () => {
    const data = { value: "hi", count: 3 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with formatted issues on validation failure", () => {
    const data = { value: 5, count: "nope" };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("value:");
      expect(e.message).toContain("count:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("truncates the raw data reported in the validation error to 500 chars", () => {
    const data = { value: "x".repeat(700), count: "bad" };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parse (integration)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a full structured output payload", () => {
    const raw = `Some reasoning text.\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({
      value: "ok",
      count: 42,
    })}\n${STRUCTURED_OUTPUT_END}\n`;

    expect(parser.parse(raw, schema)).toEqual({ value: "ok", count: 42 });
  });

  it("propagates the extraction error when delimiters are absent", () => {
    expect(() => parser.parse("no delimiters here", schema)).toThrow(
      /Could not find/,
    );
  });

  it("propagates the JSON parse error when the block is malformed JSON", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the JSON doesn't match the schema", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ value: 1 })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
