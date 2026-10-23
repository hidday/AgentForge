import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts the block between BEGIN/END delimiters", () => {
    const parser = new OutputParser();
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n{"a":1}\nEND_STRUCTURED_OUTPUT\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN delimiter when it appears more than once", () => {
    const parser = new OutputParser();
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"old":true}',
      "END_STRUCTURED_OUTPUT",
      "some chatter in between",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"new":true}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"new":true}');
  });

  it("throws OutputParseError when BEGIN delimiter is missing", () => {
    const parser = new OutputParser();
    expect(() => parser.extractStructuredBlock("no delimiters here")).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock("no delimiters here");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as Error).message).toContain("Could not find");
    }
  });

  it("throws OutputParseError when END delimiter is missing after BEGIN", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"a":1}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("no matching");
    }
  });
});

describe("OutputParser.parseJson", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"x":1}')).toEqual({ x: 1 });
  });

  it("throws OutputParseError with a snippet of the bad block on invalid JSON", () => {
    const parser = new OutputParser();
    expect(() => parser.parseJson("{not valid json")).toThrow(OutputParseError);
    try {
      parser.parseJson("{not valid json");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toContain("not valid json");
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const result = parser.validate({ success: true, value: "ok" }, schema);
    expect(result).toEqual({ success: true, value: "ok" });
  });

  it("throws OutputParseError listing the failing field paths on schema mismatch", () => {
    const parser = new OutputParser();
    expect(() => parser.validate({ success: "not-a-bool" }, schema)).toThrow(OutputParseError);
    try {
      parser.validate({ success: "not-a-bool" }, schema);
      expect.fail("should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("Structured output failed schema validation");
      expect(message).toContain("success");
      expect(message).toContain("value");
    }
  });
});

describe("OutputParser.parse (end to end)", () => {
  it("extracts, parses, and validates in one call", () => {
    const parser = new OutputParser();
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"value":"ok"}\nEND_STRUCTURED_OUTPUT`;
    expect(parser.parse(raw, schema)).toEqual({ success: true, value: "ok" });
  });

  it("propagates the extraction error when delimiters are absent", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("nothing here", schema)).toThrow(OutputParseError);
  });

  it("propagates the schema validation error for malformed payloads", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"success":true}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });
});
