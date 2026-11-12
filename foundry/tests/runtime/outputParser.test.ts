import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser.extractStructuredBlock()", () => {
  const parser = new OutputParser();

  it("extracts and trims the block between the begin/end delimiters", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const raw = "just some chatty text with no markers";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError on empty input (no begin delimiter present)", () => {
    expect(() => parser.extractStructuredBlock("")).toThrow(OutputParseError);
  });

  it("throws OutputParseError when the begin delimiter is present but the end delimiter is missing", () => {
    const raw = `noise ${STRUCTURED_OUTPUT_BEGIN} {"a":1} but no closing tag here`;
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      const beginIdx = raw.lastIndexOf(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
    }
  });

  it("uses the LAST begin delimiter when there are multiple BEGIN markers", () => {
    const raw = [
      STRUCTURED_OUTPUT_BEGIN,
      '{"old":true}',
      STRUCTURED_OUTPUT_END,
      "some chatter in between",
      STRUCTURED_OUTPUT_BEGIN,
      '{"new":true}',
      STRUCTURED_OUTPUT_END,
    ].join("\n");

    expect(parser.extractStructuredBlock(raw)).toBe('{"new":true}');
  });

  it("finds the end delimiter that follows the chosen begin, even if an end-looking token appears earlier", () => {
    // Ensures indexOf is anchored to `afterBegin`, not scanning from index 0.
    const raw = `${STRUCTURED_OUTPUT_END}noise${STRUCTURED_OUTPUT_BEGIN}{"x":1}${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"x":1}');
  });

  it("returns an empty string when the block between delimiters is empty or whitespace-only", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}   \n  ${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe("");
  });
});

describe("OutputParser.parseJson()", () => {
  const parser = new OutputParser();

  it("parses a valid JSON object", () => {
    expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("parses valid JSON primitives and arrays", () => {
    expect(parser.parseJson("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parser.parseJson("42")).toBe(42);
  });

  it("throws OutputParseError with a snippet of the offending block on invalid JSON", () => {
    const block = "{not valid json at all";
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("throws OutputParseError on an empty string", () => {
    expect(() => parser.parseJson("")).toThrow(OutputParseError);
  });

  it("truncates a long invalid block's rawOutput to the first 500 characters", () => {
    const block = "x".repeat(600) + "{not json";
    try {
      parser.parseJson(block);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput).toBe(block.slice(0, 500));
      expect(e.rawOutput!.length).toBe(500);
    }
  });
});

describe("OutputParser.validate()", () => {
  const parser = new OutputParser();
  const schema = z.object({
    success: z.boolean(),
    payload: z.object({ value: z.string() }),
  });

  it("returns the parsed data when it matches the schema", () => {
    const data = { success: true, payload: { value: "ok" } };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError listing each validation issue by path", () => {
    const data = { success: "not-a-boolean", payload: { value: 123 } };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("payload.value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("truncates rawOutput to 500 characters for a large invalid payload", () => {
    const data = { success: true, payload: { value: 42 }, extra: "z".repeat(1000) };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput!.length).toBe(500);
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("reports a missing required field as its own issue", () => {
    const data = { success: true };
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("payload:");
    }
  });
});

describe("OutputParser.parse() -- end-to-end", () => {
  const parser = new OutputParser();
  const schema = z.object({ ok: z.literal(true) });

  it("extracts, parses, and validates a well-formed structured block", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true });
  });

  it("propagates the extraction failure when no delimiters are present", () => {
    expect(() => parser.parse("no markers here", schema)).toThrow(
      new RegExp(STRUCTURED_OUTPUT_BEGIN),
    );
  });

  it("propagates the JSON parse failure when the block is not valid JSON", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}{broken${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation failure when the JSON is well-formed but invalid", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}{"ok":false}${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
