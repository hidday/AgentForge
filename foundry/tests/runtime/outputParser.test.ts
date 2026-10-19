import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string() });

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts the JSON block between the begin/end markers", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
  });

  it("uses the LAST begin marker when multiple are present (e.g. echoed prompt + real output)", () => {
    const parser = new OutputParser();
    const raw = [
      `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"stale"}\n${STRUCTURED_OUTPUT_END}`,
      `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"fresh"}\n${STRUCTURED_OUTPUT_END}`,
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"fresh"}');
  });

  it("throws OutputParseError when the begin marker is missing", () => {
    const parser = new OutputParser();
    expect(() => parser.extractStructuredBlock("no markers here")).toThrow(OutputParseError);
  });

  it("includes only the tail (last 500 chars) of raw output in the error when begin marker is missing", () => {
    const parser = new OutputParser();
    const raw = "x".repeat(600);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
    }
  });

  it("throws OutputParseError when begin marker is present but end marker is missing", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(
      /no matching.*delimiter/,
    );
  });

  it("trims surrounding whitespace from the extracted block", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n\n  {"value":"ok"}  \n\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
  });
});

describe("OutputParser.parseJson", () => {
  it("parses a valid JSON string", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with a truncated snippet on invalid JSON", () => {
    const parser = new OutputParser();
    const bad = "{not valid json" + "z".repeat(600);
    try {
      parser.parseJson(bad);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput?.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    expect(parser.validate({ value: "ok" }, schema)).toEqual({ value: "ok" });
  });

  it("throws OutputParseError listing each validation issue by path when schema validation fails", () => {
    const parser = new OutputParser();
    try {
      parser.validate({ value: 123 }, schema);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("value:");
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  it("extracts, parses, and validates a well-formed structured output block", () => {
    const parser = new OutputParser();
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
  });

  it("propagates the extraction error when markers are absent", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("nothing here", schema)).toThrow(OutputParseError);
  });

  it("propagates the schema validation error when the parsed block doesn't match the schema", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":42}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
