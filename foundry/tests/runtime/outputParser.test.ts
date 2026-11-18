import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ name: z.string(), count: z.number() });

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the block between BEGIN/END delimiters", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN delimiter when the marker appears more than once", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      "stale",
      STRUCTURED_OUTPUT_END,
      "some chatter in between",
      STRUCTURED_OUTPUT_BEGIN,
      "fresh",
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe("fresh");
  });

  it("throws OutputParseError when BEGIN delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect((err as OutputParseError).rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when END delimiter is missing after BEGIN", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });

  it("truncates the rawOutput snippet on a missing-BEGIN error to the last 500 chars", () => {
    const raw = "x".repeat(600);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toHaveLength(500);
    }
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("stringifies a non-Error throw from JSON.parse", () => {
    const originalParse = JSON.parse;
    const spy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "raw parse failure";
    });
    try {
      expect(() => parser.parseJson("{}")).toThrow(OutputParseError);
      try {
        parser.parseJson("{}");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as OutputParseError).message).toContain("raw parse failure");
      }
    } finally {
      spy.mockRestore();
      expect(JSON.parse).toBe(originalParse);
    }
  });

  it("throws OutputParseError with a message and a snippet on invalid JSON", () => {
    const block = "{not valid json";
    expect(() => parser.parseJson(block)).toThrow(OutputParseError);
    try {
      parser.parseJson(block);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { name: "foo", count: 2 };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with a joined issue list when validation fails", () => {
    const data = { name: "foo", count: "not-a-number" };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Structured output failed schema validation");
      expect((err as OutputParseError).message).toContain("count:");
      expect((err as OutputParseError).rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("reports multiple issues, one per line, when several fields are invalid", () => {
    const data = { name: 42, count: "nope" };
    try {
      parser.validate(data, schema);
      expect.fail("should have thrown");
    } catch (err) {
      const message = (err as OutputParseError).message;
      expect(message).toContain("name:");
      expect(message).toContain("count:");
    }
  });
});

describe("OutputParser.parse (end to end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({
      name: "foo",
      count: 5,
    })}\n${STRUCTURED_OUTPUT_END}`;

    expect(parser.parse(raw, schema)).toEqual({ name: "foo", count: 5 });
  });

  it("propagates the extraction error when no structured block is present", () => {
    expect(() => parser.parse("just plain text", schema)).toThrow(
      /Could not find/,
    );
  });

  it("propagates the JSON parse error when the block is malformed", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{bad json}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the block fails validation", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ name: "foo" })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
