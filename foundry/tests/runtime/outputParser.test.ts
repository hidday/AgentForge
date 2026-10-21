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
  describe("extractStructuredBlock", () => {
    it("extracts and trims the block between the delimiters", () => {
      const parser = new OutputParser();
      const raw = `preamble text\n${STRUCTURED_OUTPUT_BEGIN}\n  { "a": 1 }  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
      expect(parser.extractStructuredBlock(raw)).toBe('{ "a": 1 }');
    });

    it("uses the LAST begin delimiter when the model echoes it more than once", () => {
      const parser = new OutputParser();
      const raw = [
        STRUCTURED_OUTPUT_BEGIN,
        "stale block, ignored",
        STRUCTURED_OUTPUT_END,
        "chatter",
        STRUCTURED_OUTPUT_BEGIN,
        "fresh block",
        STRUCTURED_OUTPUT_END,
      ].join("\n");
      expect(parser.extractStructuredBlock(raw)).toBe("fresh block");
    });

    it("throws OutputParseError with a tail snippet when the begin delimiter is missing", () => {
      const parser = new OutputParser();
      const raw = "no delimiters here".padEnd(600, "x");
      try {
        parser.extractStructuredBlock(raw);
        throw new Error("expected extractStructuredBlock to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toContain(STRUCTURED_OUTPUT_BEGIN);
        expect(parseErr.rawOutput).toBe(raw.slice(-500));
        expect(parseErr.rawOutput?.length).toBe(500);
      }
    });

    it("throws OutputParseError when begin is present but end delimiter is missing", () => {
      const parser = new OutputParser();
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nunterminated block without end marker`;
      try {
        parser.extractStructuredBlock(raw);
        throw new Error("expected extractStructuredBlock to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toContain(STRUCTURED_OUTPUT_END);
        expect(parseErr.rawOutput).toContain("unterminated block");
      }
    });

    it("only searches for the end delimiter after the chosen begin index (not earlier in the string)", () => {
      const parser = new OutputParser();
      // END appears before BEGIN in the raw text; must not be matched.
      const raw = `${STRUCTURED_OUTPUT_END}\nchatter\n${STRUCTURED_OUTPUT_BEGIN}\nreal payload\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe("real payload");
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON block", () => {
      const parser = new OutputParser();
      expect(parser.parseJson('{"a":1,"b":[true,null]}')).toEqual({ a: 1, b: [true, null] });
    });

    it("throws OutputParseError with a snippet of the offending block on malformed JSON", () => {
      const parser = new OutputParser();
      const block = "{not valid json";
      try {
        parser.parseJson(block);
        throw new Error("expected parseJson to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toContain("Failed to parse JSON");
        expect(parseErr.rawOutput).toBe(block.slice(0, 500));
      }
    });

    it("truncates the snippet for very large malformed blocks", () => {
      const parser = new OutputParser();
      const block = "{".repeat(600);
      try {
        parser.parseJson(block);
        throw new Error("expected parseJson to throw");
      } catch (err) {
        const parseErr = err as OutputParseError;
        expect(parseErr.rawOutput?.length).toBe(500);
      }
    });
  });

  describe("validate", () => {
    it("returns the parsed data when it matches the schema", () => {
      const parser = new OutputParser();
      const data = { success: true, value: "ok" };
      expect(parser.validate(data, schema)).toEqual(data);
    });

    it("throws OutputParseError listing every failing path on schema mismatch", () => {
      const parser = new OutputParser();
      const data = { success: "not-a-boolean", value: 42 };
      try {
        parser.validate(data, schema);
        throw new Error("expected validate to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const parseErr = err as OutputParseError;
        expect(parseErr.message).toContain("success");
        expect(parseErr.message).toContain("value");
        expect(parseErr.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });
  });

  describe("parse (end-to-end)", () => {
    it("extracts, parses, and validates a full raw CLI output in one call", () => {
      const parser = new OutputParser();
      const raw = `thinking...\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"value":"done"}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ success: true, value: "done" });
    });

    it("propagates the extraction error when the raw output has no delimiters", () => {
      const parser = new OutputParser();
      expect(() => parser.parse("no structured output at all", schema)).toThrow(OutputParseError);
    });

    it("propagates the JSON parse error when the block isn't valid JSON", () => {
      const parser = new OutputParser();
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });

    it("propagates the schema validation error when the parsed JSON doesn't match", () => {
      const parser = new OutputParser();
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"success":true}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });
  });
});
