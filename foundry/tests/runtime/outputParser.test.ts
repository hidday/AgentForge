import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("throws when the BEGIN delimiter is missing", () => {
    const raw = "no delimiters here at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toBe('Could not find "BEGIN_STRUCTURED_OUTPUT" delimiter in output');
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws when BEGIN is found but END is missing", () => {
    const raw = "preamble\nBEGIN_STRUCTURED_OUTPUT\n{not closed";
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toBe(
        'Found "BEGIN_STRUCTURED_OUTPUT" but no matching "END_STRUCTURED_OUTPUT" delimiter',
      );
      const beginIdx = raw.indexOf("BEGIN_STRUCTURED_OUTPUT");
      expect(e.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
    }
  });

  it("extracts and trims the content between BEGIN and END", () => {
    const raw = "chatter\nBEGIN_STRUCTURED_OUTPUT\n  {\"a\":1}  \nEND_STRUCTURED_OUTPUT\ntrailing";
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("uses the LAST BEGIN delimiter when the marker text appears more than once", () => {
    const raw = [
      "BEGIN_STRUCTURED_OUTPUT",
      "{\"stale\":true}",
      "END_STRUCTURED_OUTPUT",
      "some retry chatter mentioning BEGIN_STRUCTURED_OUTPUT in prose",
      "BEGIN_STRUCTURED_OUTPUT",
      "{\"fresh\":true}",
      "END_STRUCTURED_OUTPUT",
    ].join("\n");
    expect(parser.extractStructuredBlock(raw)).toBe('{"fresh":true}');
  });

  it("finds the END delimiter nearest the last BEGIN, not an earlier one", () => {
    // A single BEGIN, but the literal END text also appears (harmlessly) before it in prose.
    const raw =
      "note: END_STRUCTURED_OUTPUT is a marker\nBEGIN_STRUCTURED_OUTPUT\n{\"ok\":true}\nEND_STRUCTURED_OUTPUT";
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with the underlying message and a truncated raw block on invalid JSON", () => {
    const block = "{not valid json";
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toMatch(/^Failed to parse JSON: /);
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("truncates a very long invalid block to 500 characters in the error", () => {
    const block = "{" + "x".repeat(900);
    const e = getThrown(() => parser.parseJson(block)) as OutputParseError;
    expect(e.rawOutput).toBe(block.slice(0, 500));
    expect(e.rawOutput!.length).toBe(500);
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();

  it("returns the parsed data when the schema validates", () => {
    const data = { success: true, stage: "planner", payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with a formatted per-field issue list on validation failure", () => {
    const data = { success: "not-a-boolean", stage: "planner", payload: { value: 42 } };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation:");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("payload.value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("reports a wrong-literal error for a mismatched discriminant field", () => {
    const data = { success: true, stage: "executor", payload: { value: "x" } };
    const e = getThrown(() => parser.validate(data, schema)) as OutputParseError;
    expect(e.message).toContain("stage:");
  });
});

describe("OutputParser.parse() — full pipeline", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `some preamble\nBEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT\n`;

    expect(parser.parse(raw, schema)).toEqual({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    });
  });

  it("propagates the extraction error when no structured block is present", () => {
    expect(() => parser.parse("just plain text", schema)).toThrow(
      /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
    );
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const raw = "BEGIN_STRUCTURED_OUTPUT\nnot json at all\nEND_STRUCTURED_OUTPUT";
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the JSON does not match the schema", () => {
    const raw = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({ success: true })}\nEND_STRUCTURED_OUTPUT`;
    expect(() => parser.parse(raw, schema)).toThrow(/Structured output failed schema validation/);
  });
});

function getThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected function to throw");
}
