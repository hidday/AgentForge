import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  payload: z.object({ value: z.string() }),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between the begin/end markers", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST begin marker when multiple are present", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      "first-stale-block",
      STRUCTURED_OUTPUT_END,
      "some chatter in between",
      STRUCTURED_OUTPUT_BEGIN,
      "second-real-block",
      STRUCTURED_OUTPUT_END,
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe("second-real-block");
  });

  it("throws OutputParseError with a tail snippet when the begin marker is missing", () => {
    const raw = "no markers here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(`Could not find "${STRUCTURED_OUTPUT_BEGIN}"`);
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when begin is found but end is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"unterminated": true}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.fail("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(`no matching "${STRUCTURED_OUTPUT_END}"`);
      expect(parseErr.rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
    }
  });

  it("only searches for the end marker after the begin marker (does not match an end marker before it)", () => {
    // END marker appears before BEGIN in the raw text -- must not be picked up.
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\ncontent`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a": 1, "b": [1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a snippet of the bad block on invalid JSON", () => {
    const bad = "{not valid json";
    expect(() => parser.parseJson(bad)).toThrow(OutputParseError);
    try {
      parser.parseJson(bad);
      expect.fail("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toBe(bad.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns parsed data when it matches the schema", () => {
    const data = { success: true, payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing field-level issues on schema mismatch", () => {
    const data = { success: "yes", payload: { value: 123 } };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.fail("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("payload.value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = [
      "Some model chatter before the answer.",
      STRUCTURED_OUTPUT_BEGIN,
      JSON.stringify({ success: true, payload: { value: "done" } }),
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, payload: { value: "done" } });
  });

  it("propagates the extraction error when markers are missing", () => {
    expect(() => parser.parse("no markers", schema)).toThrow(/Could not find/);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for well-formed JSON that fails validation", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ success: true })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
