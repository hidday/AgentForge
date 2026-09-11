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

  it("extracts and trims the content between begin/end delimiters", () => {
    const raw = `preamble text\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST begin delimiter when it appears more than once", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      "stale-block",
      STRUCTURED_OUTPUT_END,
      "some more chatter",
      STRUCTURED_OUTPUT_BEGIN,
      "fresh-block",
      STRUCTURED_OUTPUT_END,
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe("fresh-block");
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when the begin delimiter is found but the end delimiter is missing", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno closing tag here`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.message).toContain(STRUCTURED_OUTPUT_END);
      const beginIdx = raw.lastIndexOf(STRUCTURED_OUTPUT_BEGIN);
      expect(parseErr.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
    }
  });

  it("only searches for the end delimiter after the begin delimiter (does not match one appearing before it)", () => {
    const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\ninner\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe("inner");
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"x":1,"y":[1,2,3]}')).toEqual({ x: 1, y: [1, 2, 3] });
  });

  it("throws OutputParseError with a message and a truncated snippet on invalid JSON", () => {
    const block = "{not valid json";
    expect(() => parser.parseJson(block)).toThrow(OutputParseError);
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON");
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("stringifies a non-Error thrown value in the error message", () => {
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "not-an-error-instance";
    });
    try {
      expect(() => parser.parseJson("{}")).toThrow(OutputParseError);
      try {
        parser.parseJson("{}");
        expect.unreachable();
      } catch (err) {
        expect((err as OutputParseError).message).toBe(
          "Failed to parse JSON: not-an-error-instance",
        );
      }
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("truncates a very long invalid block's snippet to 500 chars", () => {
    const block = "{" + "x".repeat(900);
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput?.length).toBe(500);
      expect(parseErr.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with per-field issue messages when validation fails", () => {
    const data = { success: "not-a-boolean", payload: { value: 42 } };
    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation");
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("payload.value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("reports a missing required field", () => {
    const data = { success: true };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("payload:");
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a full structured output payload", () => {
    const raw = [
      "some chit-chat from the model",
      STRUCTURED_OUTPUT_BEGIN,
      JSON.stringify({ success: true, payload: { value: "done" } }),
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.parse(raw, schema)).toEqual({ success: true, payload: { value: "done" } });
  });

  it("propagates the extraction error when no delimiter is present", () => {
    expect(() => parser.parse("plain text, no delimiters", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
  });

  it("propagates the schema validation error for a well-formed but invalid payload", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ success: true })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
