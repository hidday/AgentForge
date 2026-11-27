import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  payload: z.object({ value: z.string() }),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the block between the delimiters", () => {
    const raw = `preamble text\nBEGIN_STRUCTURED_OUTPUT\n  {"a":1}  \nEND_STRUCTURED_OUTPUT\ntrailing`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("throws OutputParseError when BEGIN delimiter is missing", () => {
    const raw = "just some plain CLI chatter with no markers";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain('Could not find "BEGIN_STRUCTURED_OUTPUT"');
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when END delimiter is missing after BEGIN", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"a":1}\nno end marker here`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain('no matching "END_STRUCTURED_OUTPUT"');
      expect(parseErr.rawOutput).toContain("BEGIN_STRUCTURED_OUTPUT");
    }
  });

  it("truncates the rawOutput snippet for a missing-BEGIN error to the last 500 chars", () => {
    const raw = "x".repeat(900) + "[TAIL]";
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
      expect(parseErr.rawOutput).toContain("[TAIL]");
    }
  });

  it("uses the last BEGIN marker when it appears more than once (re-run / retry output)", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"stale"}',
      "END_STRUCTURED_OUTPUT",
      "some retry chatter",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"a":"fresh"}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":"fresh"}');
  });

  it("finds the nearest END after the last BEGIN, not an END belonging to an earlier block", () => {
    // beginIdx is the LAST begin marker; endIdx search starts after it, so an
    // END that appears before that begin marker must never be matched.
    const raw = [
      "END_STRUCTURED_OUTPUT", // stray end with no matching begin before it
      "noise",
      "BEGIN_STRUCTURED_OUTPUT",
      '{"ok":true}',
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with the underlying message on invalid JSON", () => {
    try {
      parser.parseJson("{not valid json");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON:");
      expect(parseErr.rawOutput).toBe("{not valid json");
    }
  });

  it("truncates the rawOutput snippet to the first 500 chars of the block", () => {
    const block = "{" + "x".repeat(900);
    try {
      parser.parseJson(block);
      expect.unreachable("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });

  describe("non-Error throw from JSON.parse", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("stringifies a non-Error thrown value in the error message", () => {
      vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "weird-string-error";
      });

      try {
        parser.parseJson('{"a":1}');
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("weird-string-error");
      }
    });
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns parsed data when it matches the schema", () => {
    const data = { success: true, payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each validation issue by path", () => {
    const data = { success: "not-a-bool", payload: { value: 42 } };
    try {
      parser.validate(data, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation:");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("payload.value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("truncates the rawOutput snippet for a schema failure to 500 chars", () => {
    const data = { success: true, payload: { value: "x".repeat(900) } };
    // force a failure by also breaking the schema shape
    const bad = { ...data, success: 123 } as unknown;
    try {
      parser.validate(bad, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parse (end to end)", () => {
  const parser = new OutputParser();

  it("extracts, parses and validates a well-formed structured block", () => {
    const raw = `chatter\nBEGIN_STRUCTURED_OUTPUT\n{"success":true,"payload":{"value":"done"}}\nEND_STRUCTURED_OUTPUT\n`;
    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, payload: { value: "done" } });
  });

  it("propagates the extraction error when no delimiter is present", () => {
    expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error when the block is malformed JSON", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{broken\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when JSON is valid but shape is wrong", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n{"success":"nope"}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/schema validation/);
  });
});
