import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the delimiters", () => {
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

  it("throws OutputParseError with a tail snippet when the begin delimiter is missing", () => {
    const raw = "x".repeat(600) + "no delimiters here";
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as Error).message).toContain("BEGIN_STRUCTURED_OUTPUT");
      expect((err as OutputParseError).rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when begin is present but end delimiter is missing", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{\"a\":1}\nno end here";
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as Error).message).toContain("END_STRUCTURED_OUTPUT");
    }
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] });
  });

  it("throws OutputParseError with a snippet of the offending block on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as Error).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe("{not valid json");
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();
  const schema = z.object({ name: z.string(), age: z.number() });

  it("returns the validated data on success", () => {
    const data = { name: "Ada", age: 30 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing the schema issues on failure", () => {
    try {
      parser.validate({ name: "Ada" }, schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as Error).message).toContain("age");
      expect((err as Error).message).toContain("Structured output failed schema validation");
    }
  });
});

describe("OutputParser.parse (end to end)", () => {
  const parser = new OutputParser();
  const schema = z.object({ value: z.string() });

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"value":"ok"}\nEND_STRUCTURED_OUTPUT`;
    expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
  });

  it("propagates the extraction error when no delimiters are present", () => {
    expect(() => parser.parse("no structured output at all", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\nnot json\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the validation error for a block that parses but fails the schema", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"value":123}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
