import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("extracts and trims the content between BEGIN/END delimiters", () => {
    const raw = `chatter before\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailing`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST occurrence of the begin delimiter when it appears more than once", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      "stale-first-block",
      STRUCTURED_OUTPUT_END,
      "some chatter in between",
      STRUCTURED_OUTPUT_BEGIN,
      "final-block",
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe("final-block");
  });

  it("throws OutputParseError when the begin delimiter is missing entirely", () => {
    const raw = "no delimiters here, just plain text output from the CLI";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(`Could not find "${STRUCTURED_OUTPUT_BEGIN}" delimiter`);
      expect(parseErr.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when begin is found but end delimiter is missing", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno end marker here`;

    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected extractStructuredBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain(`Found "${STRUCTURED_OUTPUT_BEGIN}"`);
      expect(parseErr.message).toContain(`no matching "${STRUCTURED_OUTPUT_END}"`);
      // rawOutput is a slice starting at the begin delimiter, capped at 500 chars
      expect(parseErr.rawOutput?.startsWith(STRUCTURED_OUTPUT_BEGIN)).toBe(true);
    }
  });

  it("does not match an END delimiter that appears before the (last) BEGIN delimiter", () => {
    // END appears only prior to the last BEGIN -- must be treated as "no end found".
    const raw = `${STRUCTURED_OUTPUT_END}\nchatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses a valid JSON block", () => {
    expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("throws OutputParseError with the original error message and a snippet of the input on invalid JSON", () => {
    const badBlock = "{not valid json at all";

    try {
      parser.parseJson(badBlock);
      throw new Error("expected parseJson to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Failed to parse JSON:");
      expect(parseErr.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });

  it("truncates a very long invalid block to 500 characters in the error's rawOutput", () => {
    const badBlock = "{".repeat(1000);

    try {
      parser.parseJson(badBlock);
      throw new Error("expected parseJson to throw");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.rawOutput).toHaveLength(500);
      expect(parseErr.rawOutput).toBe(badBlock.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, stage: "planner", payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with a formatted issue list when validation fails", () => {
    const data = { success: "not-a-boolean", stage: "wrong-stage", payload: { value: 42 } };

    try {
      parser.validate(data, schema);
      throw new Error("expected validate to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toContain("Structured output failed schema validation:");
      // Formatted as "  <path>: <message>" per issue, joined with newlines
      expect(parseErr.message).toContain("success:");
      expect(parseErr.message).toContain("payload.value:");
      expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("joins nested paths with dots in the issue list", () => {
    const data = { success: true, stage: "planner", payload: { value: 123 } };

    try {
      parser.validate(data, schema);
      throw new Error("expected validate to throw");
    } catch (err) {
      const parseErr = err as OutputParseError;
      expect(parseErr.message).toMatch(/payload\.value: /);
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  const parser = new OutputParser();

  it("extracts, parses and validates a well-formed structured output block", () => {
    const raw = `some preamble\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "done" },
    })}\n${STRUCTURED_OUTPUT_END}\n`;

    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, stage: "planner", payload: { value: "done" } });
  });

  it("propagates OutputParseError from extraction when delimiters are absent", () => {
    expect(() => parser.parse("no structured output at all", schema)).toThrow(OutputParseError);
  });

  it("propagates OutputParseError from JSON parsing when the block is malformed", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates OutputParseError from schema validation when the block is valid JSON but the wrong shape", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ foo: "bar" })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
