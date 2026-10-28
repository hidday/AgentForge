import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import { OutputParseError } from "../../src/utils/errors.js";

const schema = z.object({ ok: z.boolean() });

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("extracts and trims the content between the delimiters", () => {
      const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n  {"ok":true}  \n${STRUCTURED_OUTPUT_END}\nmore chatter`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
    });

    it("uses the last BEGIN delimiter when several are present", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nfirst\n${STRUCTURED_OUTPUT_END}\n${STRUCTURED_OUTPUT_BEGIN}\nsecond\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe("second");
    });

    it("throws OutputParseError when the BEGIN delimiter is missing", () => {
      expect(() => parser.extractStructuredBlock("no delimiters here")).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock("no delimiters here");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
        expect((err as OutputParseError).rawOutput).toBe("no delimiters here");
      }
    });

    it("throws OutputParseError when the END delimiter is missing", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}`;
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
      }
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON block", () => {
      expect(parser.parseJson('{"ok":true}')).toEqual({ ok: true });
    });

    it("throws OutputParseError with a snippet of the offending block on invalid JSON", () => {
      try {
        parser.parseJson("{not json");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("Failed to parse JSON");
        expect((err as OutputParseError).rawOutput).toBe("{not json");
      }
    });
  });

  describe("validate", () => {
    it("returns the parsed data when it matches the schema", () => {
      expect(parser.validate({ ok: true }, schema)).toEqual({ ok: true });
    });

    it("throws OutputParseError listing the validation issues on mismatch", () => {
      try {
        parser.validate({ ok: "not-a-boolean" }, schema);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("Structured output failed schema validation");
        expect((err as OutputParseError).message).toContain("ok:");
      }
    });
  });

  describe("parse", () => {
    it("extracts, parses, and validates a well-formed block end-to-end", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ ok: true });
    });

    it("propagates the extraction error when delimiters are missing", () => {
      expect(() => parser.parse("nothing to see here", schema)).toThrow(OutputParseError);
    });

    it("propagates the validation error when the parsed JSON fails the schema", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":"nope"}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });
  });
});
