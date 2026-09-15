import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string(), count: z.number() });

describe("OutputParser.extractStructuredBlock()", () => {
  it("extracts and trims the block between the begin/end delimiters", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"value":"x","count":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;

    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"x","count":1}');
  });

  it("uses the LAST begin delimiter when there are multiple", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"stale":true}\n${STRUCTURED_OUTPUT_END}\nmore text\n${STRUCTURED_OUTPUT_BEGIN}\n{"fresh":true}\n${STRUCTURED_OUTPUT_END}`;

    expect(parser.extractStructuredBlock(raw)).toBe('{"fresh":true}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = "just some plain CLI chatter with no markers at all";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when begin is found but end is missing", () => {
    const parser = new OutputParser();
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"unterminated"`;

    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_END);
      const beginIdx = raw.indexOf(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
    }
  });
});

describe("OutputParser.parseJson()", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a snippet of the offending block on invalid JSON", () => {
    const parser = new OutputParser();
    const block = "{not valid json";

    try {
      parser.parseJson(block);
      expect.unreachable("expected parseJson to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON:");
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate()", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { value: "hello", count: 3 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing issues when validation fails", () => {
    const parser = new OutputParser();
    const badData = { value: 42, count: "not-a-number" };

    try {
      parser.validate(badData, schema);
      expect.unreachable("expected validate to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation:");
      expect(parseErr.message).toContain("value:");
      expect(parseErr.message).toContain("count:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(badData).slice(0, 500));
    }
  });
});

describe("OutputParser.parse() (integration)", () => {
  it("extracts, parses, and validates a full structured output block", () => {
    const parser = new OutputParser();
    const raw = `Some thinking...\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok","count":7}\n${STRUCTURED_OUTPUT_END}`;

    expect(parser.parse(raw, schema)).toEqual({ value: "ok", count: 7 });
  });

  it("propagates OutputParseError from the JSON stage when the block isn't valid JSON", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;

    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    expect(() => parser.parse(raw, schema)).toThrow("Failed to parse JSON:");
  });

  it("propagates OutputParseError from the validation stage when the JSON doesn't match the schema", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}`;

    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    expect(() => parser.parse(raw, schema)).toThrow("Structured output failed schema validation:");
  });
});
