import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("extracts and trims the content between the begin/end delimiters", () => {
      const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailing`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
    });

    it("uses the LAST begin delimiter when it appears more than once", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"first":true}\n${STRUCTURED_OUTPUT_END}\nnoise\n${STRUCTURED_OUTPUT_BEGIN}\n{"second":true}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"second":true}');
    });

    it("throws OutputParseError when the begin delimiter is missing", () => {
      const raw = "no delimiters here, just plain text output from the CLI";
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
        expect(e.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("throws OutputParseError when begin is present but end delimiter is missing", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}\nno end here`;
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.message).toContain(STRUCTURED_OUTPUT_END);
        expect(e.rawOutput).toContain('{"a":1}');
      }
    });

    it("truncates a very long unterminated-begin snippet to 500 chars from the raw tail", () => {
      const raw = "x".repeat(1000);
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput!.length).toBe(500);
      }
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON block", () => {
      expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
    });

    it("throws OutputParseError with a message and snippet on invalid JSON", () => {
      const block = "{not valid json";
      try {
        parser.parseJson(block);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain("Failed to parse JSON");
        expect(e.rawOutput).toBe(block);
      }
    });

    it("truncates the rawOutput snippet to 500 chars for a long invalid block", () => {
      const block = "{" + "x".repeat(1000);
      try {
        parser.parseJson(block);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput!.length).toBe(500);
      }
    });
  });

  describe("validate", () => {
    it("returns parsed data when schema validation succeeds", () => {
      const data = { success: true, value: "ok" };
      expect(parser.validate(data, schema)).toEqual(data);
    });

    it("throws OutputParseError with formatted issue paths and messages on failure", () => {
      const data = { success: "not-a-bool", value: 5 };
      try {
        parser.validate(data, schema);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain("Structured output failed schema validation");
        expect(e.message).toContain("success:");
        expect(e.message).toContain("value:");
        expect(e.rawOutput).toBe(JSON.stringify(data));
      }
    });

    it("truncates a large invalid payload's rawOutput to 500 chars", () => {
      const data = { success: "x".repeat(1000), value: "x".repeat(1000) };
      try {
        parser.validate(data, schema);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput!.length).toBe(500);
      }
    });
  });

  describe("parse (integration)", () => {
    it("extracts, parses and validates a full structured block", () => {
      const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"value":"done"}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
    });

    it("propagates the extraction error when delimiters are absent", () => {
      expect(() => parser.parse("no markers", schema)).toThrow(OutputParseError);
    });

    it("propagates the validation error when the JSON does not match the schema", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"success":true}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });
  });
});
