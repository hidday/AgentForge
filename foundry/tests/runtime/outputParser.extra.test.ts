import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("throws OutputParseError when the BEGIN delimiter is missing", () => {
    expect(() => parser.extractStructuredBlock("no markers here at all")).toThrow(
      OutputParseError,
    );
    try {
      parser.extractStructuredBlock("no markers here at all");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("throws OutputParseError when the END delimiter is missing after BEGIN", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\n`;
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });

  it("uses the LAST occurrence of BEGIN when it appears multiple times", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      '{"stale":true}',
      STRUCTURED_OUTPUT_END,
      "some chatter in between",
      STRUCTURED_OUTPUT_BEGIN,
      '{"fresh":true}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    const block = parser.extractStructuredBlock(raw);
    expect(block).toBe('{"fresh":true}');
  });

  it("trims surrounding whitespace from the extracted block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n\n  {"a":1}  \n\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("includes a tail snippet (last 500 chars) of raw output in the error when BEGIN is missing", () => {
    const raw = "x".repeat(600) + "[END_MARKER]";
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toContain("[END_MARKER]");
      expect((err as OutputParseError).rawOutput?.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and raw snippet on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe("{not valid json");
    }
  });

  it("truncates the raw snippet on invalid JSON to the first 500 chars", () => {
    const longBad = "{" + "x".repeat(600);
    try {
      parser.parseJson(longBad);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();
  const schema = z.object({ name: z.string(), age: z.number() });

  it("returns the parsed data when it matches the schema", () => {
    const data = { name: "Ada", age: 30 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing every validation issue when data doesn't match", () => {
    try {
      parser.validate({ name: 42, age: "old" }, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const message = (err as OutputParseError).message;
      expect(message).toContain("Structured output failed schema validation");
      expect(message).toContain("name");
      expect(message).toContain("age");
    }
  });

  it("includes a JSON snippet of the offending data in the error", () => {
    try {
      parser.validate({ name: 1, age: 2 }, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toContain('"name":1');
    }
  });
});

describe("OutputParser.parse() end-to-end", () => {
  const parser = new OutputParser();
  const schema = z.object({ ok: z.boolean() });

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter before\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}\nchatter after`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true });
  });

  it("propagates the schema validation error for a syntactically valid but schema-invalid block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":"not-a-bool"}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
