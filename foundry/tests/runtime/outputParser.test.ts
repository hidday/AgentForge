import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser", () => {
  const parser = new OutputParser();
  const schema = z.object({ value: z.string() });

  describe("extractStructuredBlock", () => {
    it("extracts and trims the content between BEGIN and END delimiters", () => {
      const raw = `noise before\n${STRUCTURED_OUTPUT_BEGIN}\n  {"value":"ok"}  \n${STRUCTURED_OUTPUT_END}\nnoise after`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
    });

    it("uses the LAST BEGIN delimiter when the marker string appears more than once", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"stale"}\n${STRUCTURED_OUTPUT_END}\nmore output\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"fresh"}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"fresh"}');
    });

    it("throws OutputParseError with a tail snippet when no BEGIN delimiter is present", () => {
      const raw = "plain text with no structured markers at all";
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

    it("throws OutputParseError when BEGIN is present but END is missing", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}`;
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
        expect((err as OutputParseError).rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
      }
    });

    it("searches for END only after the matched BEGIN occurrence (not an END that precedes it)", () => {
      const raw = `${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"ok"}');
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON block", () => {
      expect(parser.parseJson('{"value":"ok"}')).toEqual({ value: "ok" });
    });

    it("throws OutputParseError with a head snippet on malformed JSON", () => {
      const block = "{not valid json";
      expect(() => parser.parseJson(block)).toThrow(OutputParseError);
      try {
        parser.parseJson(block);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("Failed to parse JSON");
        expect((err as OutputParseError).rawOutput).toBe(block.slice(0, 500));
      }
    });
  });

  describe("validate", () => {
    it("returns parsed data when it matches the schema", () => {
      expect(parser.validate({ value: "ok" }, schema)).toEqual({ value: "ok" });
    });

    it("throws OutputParseError listing each path/message on schema validation failure", () => {
      const data = { value: 42 };
      expect(() => parser.validate(data, schema)).toThrow(OutputParseError);
      try {
        parser.validate(data, schema);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("value");
        expect((err as OutputParseError).rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });
  });

  describe("parse (end-to-end)", () => {
    it("extracts, parses, and validates a full structured output block", () => {
      const raw = `some CLI chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ value: "ok" });
    });

    it("propagates the extraction error when the raw output has no delimiters", () => {
      expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
    });

    it("propagates the validation error when the block parses but fails the schema", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":123}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });
  });
});
