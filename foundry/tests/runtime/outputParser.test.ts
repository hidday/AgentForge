import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the delimiters", () => {
    const raw = `some preamble\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    expect(() => parser.extractStructuredBlock("no delimiters here")).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock("no delimiters here");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("BEGIN_STRUCTURED_OUTPUT");
    }
  });

  it("throws OutputParseError when the end delimiter is missing", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\n{not closed";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("END_STRUCTURED_OUTPUT");
      expect((err as OutputParseError).rawOutput).toContain("BEGIN_STRUCTURED_OUTPUT");
    }
  });

  it("uses the LAST begin delimiter when multiple are present (e.g. retried CLI output)", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"stale"}',
      "END_STRUCTURED_OUTPUT",
      "some chatter in between",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"fresh"}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":"fresh"}');
  });

  it("includes only the tail of very long output in the error's rawOutput when no begin delimiter is found", () => {
    const raw = "x".repeat(1000);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toHaveLength(500);
    }
  });

  it("requires the end delimiter to occur after the begin delimiter's position", () => {
    // END appears textually before BEGIN's *content* starts but after BEGIN's
    // index would still be searched from afterBegin onward; an END that only
    // appears before BEGIN must not satisfy the search.
    const raw = "END_STRUCTURED_OUTPUT\nBEGIN_STRUCTURED_OUTPUT\nno end after this";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and a truncated raw snippet on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe("{not valid json");
    }
  });

  it("truncates the raw snippet in the error to 500 characters", () => {
    const longBadJson = "{" + "x".repeat(1000);
    try {
      parser.parseJson(longBadJson);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toHaveLength(500);
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, value: "ok" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each validation issue by path when the schema does not match", () => {
    const data = { success: "not-a-boolean", value: 42 };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const message = (err as OutputParseError).message;
      expect(message).toContain("Structured output failed schema validation");
      expect(message).toContain("success:");
      expect(message).toContain("value:");
    }
  });

  it("includes a JSON snippet of the offending data in the error", () => {
    const data = { success: "nope", value: 1 };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toBe(JSON.stringify(data));
    }
  });

  it("reports a missing required field as a validation issue", () => {
    try {
      parser.validate({ success: true }, schema);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).message).toContain("value:");
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed CLI output in one call", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"value":"done"}\nEND_STRUCTURED_OUTPUT\n`;
    expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
  });

  it("propagates the delimiter error when no structured block is present", () => {
    expect(() => parser.parse("just text, no markers", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON error when the block is not valid JSON", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\nnot json at all\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the JSON is well-formed but invalid", () => {
    const raw = 'BEGIN_STRUCTURED_OUTPUT\n{"success":true}\nEND_STRUCTURED_OUTPUT';
    expect(() => parser.parse(raw, schema)).toThrow(/schema validation/);
  });
});
