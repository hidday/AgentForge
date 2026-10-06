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

describe("OutputParser.extractStructuredBlock()", () => {
  it("extracts and trims the block between the begin/end markers", () => {
    const parser = new OutputParser();
    const raw = `chatter before\n${STRUCTURED_OUTPUT_BEGIN}\n  { "a": 1 }  \n${STRUCTURED_OUTPUT_END}\ntrailing chatter`;

    expect(parser.extractStructuredBlock(raw)).toBe('{ "a": 1 }');
  });

  it("uses the LAST begin marker when multiple are present", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nfirst-stale-block\n${STRUCTURED_OUTPUT_END}\nmore chatter\n${STRUCTURED_OUTPUT_BEGIN}\nsecond-real-block\n${STRUCTURED_OUTPUT_END}`;

    expect(parser.extractStructuredBlock(raw)).toBe("second-real-block");
  });

  it("throws OutputParseError when the begin delimiter is missing entirely", () => {
    const parser = new OutputParser();
    const raw = "no markers here, just plain chatty text from the model";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("truncates the rawOutput tail to the last 500 chars when the begin marker is missing on long output", () => {
    const parser = new OutputParser();
    const raw = "x".repeat(600) + "[END_MARKER]";

    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toContain("[END_MARKER]");
    }
  });

  it("throws OutputParseError when begin is found but end delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"incomplete": true}\nno end marker here`;

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.rawOutput).toContain('{"incomplete": true}');
    }
  });

  it("does not match an END marker that appears before the chosen BEGIN marker", () => {
    const parser = new OutputParser();
    // END appears textually before BEGIN; extractStructuredBlock must search for END only
    // *after* the begin index, so this should be treated as "no end found".
    const raw = `${STRUCTURED_OUTPUT_END}\nsome text\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson()", () => {
  it("parses a valid JSON block", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with the original message on malformed JSON", () => {
    const parser = new OutputParser();
    const malformed = "{not valid json,,,";

    expect(() => parser.parseJson(malformed)).toThrow(OutputParseError);
    try {
      parser.parseJson(malformed);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(malformed.slice(0, 500));
    }
  });

  it("throws OutputParseError on empty-string input", () => {
    const parser = new OutputParser();
    expect(() => parser.parseJson("")).toThrow(OutputParseError);
  });

  it("truncates the rawOutput head to the first 500 chars for long malformed blocks", () => {
    const parser = new OutputParser();
    const malformed = "{" + "x".repeat(600);

    try {
      parser.parseJson(malformed);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.validate()", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { success: true, stage: "planner", payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each schema issue when validation fails", () => {
    const parser = new OutputParser();
    const data = { success: "not-a-bool", stage: "wrong-stage", payload: { value: 42 } };

    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("payload.value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("truncates the serialized rawOutput for a large invalid payload", () => {
    const parser = new OutputParser();
    // Invalid (wrong stage literal) and large enough that JSON.stringify exceeds 500 chars.
    const data = {
      success: true,
      stage: "not-planner",
      payload: { value: "ok" },
      extraPadding: "x".repeat(600),
    };

    try {
      parser.validate(data, schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
    }
  });
});

describe("OutputParser.parse() — end to end", () => {
  it("extracts, parses, and validates a full structured-output envelope", () => {
    const parser = new OutputParser();
    const raw = `Here's my plan.\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\n${STRUCTURED_OUTPUT_END}\n`;

    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, stage: "planner", payload: { value: "ok" } });
  });

  it("propagates the extraction failure when no markers are present", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("just plain text, no markers", schema)).toThrow(
      /Could not find/,
    );
  });

  it("propagates the JSON parse failure when the block is not valid JSON", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json at all\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation failure when JSON is well-formed but invalid", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ success: true })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });

  it("throws on an empty raw string", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("", schema)).toThrow(OutputParseError);
  });
});
