import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("throws OutputParseError when the BEGIN delimiter is missing", () => {
      const raw = "just some plain CLI chatter with no markers";
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        throw new Error("expected extractStructuredBlock to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
        expect(e.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("includes only the tail (last 500 chars) of a long raw string when BEGIN is missing", () => {
      const raw = "x".repeat(1000);
      try {
        parser.extractStructuredBlock(raw);
        throw new Error("expected throw");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput).toHaveLength(500);
        expect(e.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("throws OutputParseError when BEGIN is present but END is missing", () => {
      const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;
      try {
        parser.extractStructuredBlock(raw);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
        expect(e.message).toContain(STRUCTURED_OUTPUT_END);
        expect(e.message).toContain("no matching");
        expect(e.rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
      }
    });

    it("extracts and trims the block between BEGIN and END", () => {
      const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailing`;
      const block = parser.extractStructuredBlock(raw);
      expect(block).toBe('{"a":1}');
    });

    it("uses the LAST occurrence of BEGIN when it appears multiple times", () => {
      const raw =
        `${STRUCTURED_OUTPUT_BEGIN}\n{"old":true}\n${STRUCTURED_OUTPUT_END}\n` +
        `more chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"new":true}\n${STRUCTURED_OUTPUT_END}`;
      const block = parser.extractStructuredBlock(raw);
      expect(block).toBe('{"new":true}');
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON block", () => {
      expect(parser.parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
    });

    it("throws OutputParseError with a message and truncated snippet on invalid JSON", () => {
      const block = "{not valid json";
      try {
        parser.parseJson(block);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain("Failed to parse JSON");
        expect(e.rawOutput).toBe(block.slice(0, 500));
      }
    });

    it("truncates the snippet to the first 500 chars of a long invalid block", () => {
      const block = `{${"x".repeat(1000)}`;
      try {
        parser.parseJson(block);
        throw new Error("expected throw");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput).toHaveLength(500);
        expect(e.rawOutput).toBe(block.slice(0, 500));
      }
    });
  });

  describe("validate", () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it("returns the parsed data when validation succeeds", () => {
      const data = { name: "Ada", age: 30 };
      expect(parser.validate(data, schema)).toEqual(data);
    });

    it("throws OutputParseError with formatted issue paths and messages on failure", () => {
      const data = { name: 5, age: "not a number" };
      try {
        parser.validate(data, schema);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain("Structured output failed schema validation");
        expect(e.message).toContain("name:");
        expect(e.message).toContain("age:");
        expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });

    it("formats nested paths with dot notation in the issue list", () => {
      const nestedSchema = z.object({ payload: z.object({ value: z.string() }) });
      try {
        nestedSchema.parse; // no-op to keep import used meaningfully
        parser.validate({ payload: { value: 5 } }, nestedSchema);
        throw new Error("expected throw");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.message).toContain("payload.value:");
      }
    });
  });

  describe("parse (end-to-end)", () => {
    const schema = z.object({ ok: z.boolean() });

    it("extracts, parses, and validates a well-formed structured block", () => {
      const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ ok: true });
    });

    it("propagates the extraction error when delimiters are absent", () => {
      expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
    });

    it("propagates the JSON parse error when the block is malformed", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
    });

    it("propagates the schema validation error when the block doesn't match", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":"not-a-bool"}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
    });
  });
});
