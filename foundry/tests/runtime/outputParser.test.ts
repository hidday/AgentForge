import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string() });

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts the trimmed content between the begin/end delimiters", () => {
    const parser = new OutputParser();
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n  {"value":"ok"}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
  });

  it("uses the LAST begin delimiter when the model repeats itself", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"first"}\n${STRUCTURED_OUTPUT_END}\nmore text\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"second"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"second"}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const parser = new OutputParser();
    expect(() => parser.extractStructuredBlock("just plain chatter with no markers")).toThrow(
      OutputParseError,
    );
    try {
      parser.extractStructuredBlock("just plain chatter");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("throws OutputParseError when the begin delimiter is present but the end delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
    } catch (err) {
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });
});

describe("OutputParser.parseJson", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with the offending block on invalid JSON", () => {
    const parser = new OutputParser();
    expect(() => parser.parseJson("{not json")).toThrow(OutputParseError);
    try {
      parser.parseJson("{not json");
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toContain("{not json");
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    expect(parser.validate({ value: "ok" }, schema)).toEqual({ value: "ok" });
  });

  it("throws OutputParseError listing the path/message of each validation issue", () => {
    const parser = new OutputParser();
    expect(() => parser.validate({ value: 123 }, schema)).toThrow(OutputParseError);
    try {
      parser.validate({ value: 123 }, schema);
    } catch (err) {
      expect((err as OutputParseError).message).toContain("value:");
      expect((err as OutputParseError).rawOutput).toContain("123");
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  it("extracts, parses, and validates a well-formed structured block", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
  });

  it("propagates the extraction failure when no delimiters are present", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse failure when the block is not valid JSON", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json at all\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });

  it("propagates the schema validation failure when JSON is valid but shape is wrong", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":42}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
