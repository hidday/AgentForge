import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock()", () => {
  it("extracts and trims the content between the begin/end delimiters", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;

    const block = parser.extractStructuredBlock(raw);

    expect(block).toBe('{"a":1}');
  });

  it("uses the LAST begin delimiter when there are multiple", () => {
    const parser = new OutputParser();
    const raw =
      `${STRUCTURED_OUTPUT_BEGIN}\nFIRST\n${STRUCTURED_OUTPUT_END}\n` +
      `${STRUCTURED_OUTPUT_BEGIN}\nSECOND\n${STRUCTURED_OUTPUT_END}`;

    const block = parser.extractStructuredBlock(raw);

    expect(block).toBe("SECOND");
  });

  it("throws OutputParseError when the begin delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = "no delimiters here at all";

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect((err as OutputParseError).rawOutput).toBe(raw.slice(-500));
    }
  });

  it("includes only the tail (last 500 chars) of raw in the error when begin delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = "x".repeat(600) + "[END_MARKER]";

    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput).toBe(raw.slice(-500));
      expect((err as OutputParseError).rawOutput).toContain("[END_MARKER]");
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
    }
  });

  it("throws OutputParseError when begin delimiter is present but end delimiter is missing", () => {
    const parser = new OutputParser();
    const raw = `preamble ${STRUCTURED_OUTPUT_BEGIN} {"a":1} no end here`;

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
    }
  });

  it("only searches for the end delimiter after the begin delimiter's position", () => {
    // Put an END marker BEFORE the BEGIN marker; it must be ignored, so this
    // should behave as if there's no end delimiter at all after begin.
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_END}\nsome text\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;

    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
  });
});

describe("OutputParser.parseJson()", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    const result = parser.parseJson('{"a":1,"b":"two"}');
    expect(result).toEqual({ a: 1, b: "two" });
  });

  it("throws OutputParseError with a message and a truncated snippet on invalid JSON", () => {
    const parser = new OutputParser();
    const bad = "{not valid json";

    expect(() => parser.parseJson(bad)).toThrow(OutputParseError);
    try {
      parser.parseJson(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).message).toContain("Failed to parse JSON");
      expect((err as OutputParseError).rawOutput).toBe(bad.slice(0, 500));
    }
  });

  it("truncates the rawOutput snippet to the first 500 characters on invalid JSON", () => {
    const parser = new OutputParser();
    const bad = "{" + "a".repeat(600);

    try {
      parser.parseJson(bad);
      expect.unreachable();
    } catch (err) {
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
      expect((err as OutputParseError).rawOutput).toBe(bad.slice(0, 500));
    }
  });
});

describe("OutputParser.validate()", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { success: true, value: "ok" };

    const result = parser.validate(data, schema);

    expect(result).toEqual(data);
  });

  it("throws OutputParseError with per-issue path/message lines when validation fails", () => {
    const parser = new OutputParser();
    const data = { success: "not-a-boolean", value: 123 };

    expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const message = (err as OutputParseError).message;
      expect(message).toContain("Structured output failed schema validation");
      expect(message).toContain("success:");
      expect(message).toContain("value:");
      expect((err as OutputParseError).rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("truncates the rawOutput snippet to the first 500 characters of the stringified data", () => {
    const parser = new OutputParser();
    // Invalid (success must be boolean) and long, to exercise the truncation.
    const data = { success: "not-a-boolean", value: "a".repeat(600) };

    try {
      parser.validate(data, schema);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      expect((err as OutputParseError).rawOutput?.length).toBe(500);
      expect((err as OutputParseError).rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse()", () => {
  it("extracts, parses, and validates a full structured output end-to-end", () => {
    const parser = new OutputParser();
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"value":"ok"}\n${STRUCTURED_OUTPUT_END}\n`;

    const result = parser.parse(raw, schema);

    expect(result).toEqual({ success: true, value: "ok" });
  });

  it("propagates the extraction error when delimiters are missing", () => {
    const parser = new OutputParser();
    const raw = "nothing structured here";

    expect(() => parser.parse(raw, schema)).toThrow(/Could not find/);
  });

  it("propagates the JSON parse error when the block is not valid JSON", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;

    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error when the parsed data doesn't match the schema", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"success":true}\n${STRUCTURED_OUTPUT_END}`;

    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
