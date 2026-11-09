import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock()", () => {
  it("extracts and trims the block between BEGIN/END markers", () => {
    const parser = new OutputParser();
    const raw = `preamble\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailer`;

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN marker when it appears more than once", () => {
    const parser = new OutputParser();
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "stale",
      "END_STRUCTURED_OUTPUT",
      "noise",
      "BEGIN_STRUCTURED_OUTPUT",
      "fresh",
      "END_STRUCTURED_OUTPUT",
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe("fresh");
  });

  it("throws OutputParseError when no BEGIN marker is present", () => {
    const parser = new OutputParser();
    expect(() => parser.extractStructuredBlock("just some plain text output")).toThrow(
      OutputParseError,
    );
  });

  it("includes a tail snippet of the raw output (max 500 chars) in the error when BEGIN is missing", () => {
    const parser = new OutputParser();
    const raw = "x".repeat(600) + "[TAIL]";

    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT"');
      expect(parseErr.rawOutput).toContain("[TAIL]");
      expect(parseErr.rawOutput?.length).toBeLessThanOrEqual(500);
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"a":1}\nno end marker here`;

    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain('no matching "END_STRUCTURED_OUTPUT"');
      expect(parseErr.rawOutput).toContain('{"a":1}');
    }
  });

  it("only searches for END after the BEGIN marker position (ignores an END that precedes BEGIN)", () => {
    const parser = new OutputParser();
    const raw = `END_STRUCTURED_OUTPUT\nBEGIN_STRUCTURED_OUTPUT\n{"a":1}\nEND_STRUCTURED_OUTPUT`;

    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });
});

describe("OutputParser.parseJson()", () => {
  it("parses a valid JSON block", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("throws OutputParseError with a snippet of the block on invalid JSON", () => {
    const parser = new OutputParser();
    const badBlock = "{not valid json";

    try {
      parser.parseJson(badBlock);
      expect.unreachable("expected parseJson to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toBe(badBlock);
    }
  });

  it("truncates the raw block snippet in the error to 500 chars", () => {
    const parser = new OutputParser();
    const badBlock = "{" + "x".repeat(600);

    try {
      parser.parseJson(badBlock);
      expect.unreachable("expected parseJson to throw");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate()", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { success: true, value: "ok" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each validation issue when the schema fails", () => {
    const parser = new OutputParser();
    const data = { success: "not-a-boolean", value: 42 };

    try {
      parser.validate(data, schema);
      expect.unreachable("expected validate to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("value:");
      expect(parseErr.rawOutput).toContain('"success":"not-a-boolean"');
    }
  });

  it("truncates the serialized data snippet in the error to 500 chars", () => {
    const parser = new OutputParser();
    const data = { success: "not-a-boolean", value: "y".repeat(600) };

    try {
      parser.validate(data, schema);
      expect.unreachable("expected validate to throw");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parse() — end to end", () => {
  it("extracts, parses, and validates a full structured output block", () => {
    const parser = new OutputParser();
    const raw = `chatter before\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"value":"done"}\nEND_STRUCTURED_OUTPUT\n`;

    expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
  });

  it("propagates the extraction error when markers are missing", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("no markers at all", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{not json\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a well-formed but invalid block", () => {
    const parser = new OutputParser();
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"success":true}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
