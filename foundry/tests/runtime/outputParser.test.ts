import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import { OutputParseError } from "../../src/utils/errors.js";

describe("OutputParser", () => {
  const parser = new OutputParser();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("extractStructuredBlock", () => {
    it("extracts and trims the block between the begin and end delimiters", () => {
      const raw = `some preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
    });

    it("uses the LAST begin delimiter when the marker appears more than once", () => {
      const raw = [
        STRUCTURED_OUTPUT_BEGIN,
        "stale block",
        STRUCTURED_OUTPUT_END,
        "more text",
        STRUCTURED_OUTPUT_BEGIN,
        "fresh block",
        STRUCTURED_OUTPUT_END,
      ].join("\n");

      expect(parser.extractStructuredBlock(raw)).toBe("fresh block");
    });

    it("throws OutputParseError when the begin delimiter is missing", () => {
      const raw = "no delimiters here at all";

      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toBe(
          `Could not find "${STRUCTURED_OUTPUT_BEGIN}" delimiter in output`,
        );
        expect(parseErr.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("throws OutputParseError on empty input (begin delimiter missing)", () => {
      expect(() => parser.extractStructuredBlock("")).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock("");
        expect.unreachable("should have thrown");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.rawOutput).toBe("");
      }
    });

    it("truncates rawOutput to the last 500 characters when the begin delimiter is missing", () => {
      const raw = "x".repeat(600);

      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable("should have thrown");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.rawOutput).toHaveLength(500);
        expect(parseErr.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("throws OutputParseError when the end delimiter is missing after begin", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno closing marker`;

      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toBe(
          `Found "${STRUCTURED_OUTPUT_BEGIN}" but no matching "${STRUCTURED_OUTPUT_END}" delimiter`,
        );
        expect(parseErr.rawOutput).toBe(raw.slice(0, 500));
      }
    });

    it("does not match an end delimiter that occurs before the begin delimiter", () => {
      // The END marker earlier in the stream (from a prior/stale block) must not
      // be treated as closing this BEGIN; indexOf starts searching after BEGIN.
      const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;

      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    });

    it("handles multi-line / streamed output assembled into one string", () => {
      const lines = [
        "line one of streamed output",
        "line two of streamed output",
        STRUCTURED_OUTPUT_BEGIN,
        "{",
        '  "ok": true,',
        '  "items": [1, 2, 3]',
        "}",
        STRUCTURED_OUTPUT_END,
        "final trailing line",
      ];
      const raw = lines.join("\n");

      expect(parser.extractStructuredBlock(raw)).toBe('{\n  "ok": true,\n  "items": [1, 2, 3]\n}');
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON object", () => {
      expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
    });

    it("parses a valid JSON array", () => {
      expect(parser.parseJson("[1,2,3]")).toEqual([1, 2, 3]);
    });

    it("throws OutputParseError with the underlying message for malformed JSON", () => {
      const block = "{not valid json";

      try {
        parser.parseJson(block);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toMatch(/^Failed to parse JSON: /);
        expect(parseErr.rawOutput).toBe(block.slice(0, 500));
      }
    });

    it("throws OutputParseError for partial/truncated JSON", () => {
      const block = '{"a": 1, "b": [1, 2,';

      expect(() => parser.parseJson(block)).toThrow(OutputParseError);
    });

    it("throws OutputParseError for empty string input", () => {
      expect(() => parser.parseJson("")).toThrow(OutputParseError);
    });

    it("truncates rawOutput to the first 500 characters of a long malformed block", () => {
      const block = "{" + "x".repeat(600);

      try {
        parser.parseJson(block);
        expect.unreachable("should have thrown");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.rawOutput).toHaveLength(500);
        expect(parseErr.rawOutput).toBe(block.slice(0, 500));
      }
    });

    it("stringifies a non-Error throw value in the message (defensive branch)", () => {
      vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "not-an-error-object";
      });

      try {
        parser.parseJson('{"a":1}');
        expect.unreachable("should have thrown");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toBe("Failed to parse JSON: not-an-error-object");
      }
    });
  });

  describe("validate", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it("returns the parsed data when it matches the schema", () => {
      const data = { name: "Ada", age: 30 };
      expect(parser.validate(data, schema)).toEqual(data);
    });

    it("throws OutputParseError with per-field issues when validation fails", () => {
      const data = { name: 42, age: "not-a-number" };

      try {
        parser.validate(data, schema);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toContain("Structured output failed schema validation:");
        expect(parseErr.message).toContain("name:");
        expect(parseErr.message).toContain("age:");
        expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });

    it("reports a nested path for issues on nested fields", () => {
      const nestedSchema = z.object({
        payload: z.object({
          count: z.number(),
        }),
      });

      try {
        parser.validate({ payload: { count: "oops" } }, nestedSchema);
        expect.unreachable("should have thrown");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toContain("payload.count:");
      }
    });

    it("throws for an unexpected output shape (missing required fields)", () => {
      expect(() => parser.validate({}, schema)).toThrow(OutputParseError);
    });

    it("throws for completely unexpected output shape (array instead of object)", () => {
      expect(() => parser.validate([1, 2, 3], schema)).toThrow(OutputParseError);
    });

    it("truncates rawOutput to 500 characters for large invalid payloads", () => {
      const data = { name: "x".repeat(600), age: "nope" };

      try {
        parser.validate(data, schema);
        expect.unreachable("should have thrown");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.rawOutput).toHaveLength(500);
        expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });
  });

  describe("parse (end-to-end)", () => {
    const schema = z.object({
      success: z.boolean(),
      value: z.number(),
    });

    it("extracts, parses, and validates a well-formed structured block", () => {
      const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"value":7}\n${STRUCTURED_OUTPUT_END}\nmore noise`;

      expect(parser.parse(raw, schema)).toEqual({ success: true, value: 7 });
    });

    it("propagates the extraction error when delimiters are absent", () => {
      expect(() => parser.parse("plain text output, no markers", schema)).toThrow(
        /Could not find/,
      );
    });

    it("propagates the JSON parse error for malformed JSON inside delimiters", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json at all\n${STRUCTURED_OUTPUT_END}`;

      expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
    });

    it("propagates the schema validation error for a mismatched shape", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"success":"yes","value":"seven"}\n${STRUCTURED_OUTPUT_END}`;

      expect(() => parser.parse(raw, schema)).toThrow(
        /Structured output failed schema validation/,
      );
    });

    it("handles an empty raw string end-to-end", () => {
      expect(() => parser.parse("", schema)).toThrow(OutputParseError);
    });
  });
});
