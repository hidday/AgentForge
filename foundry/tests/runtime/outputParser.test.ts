import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import { OutputParseError } from "../../src/utils/errors.js";

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("extracts and trims the content between the delimiters", () => {
      const raw = `some preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailing`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
    });

    it("uses the last BEGIN marker when there are multiple", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}{"old":true}${STRUCTURED_OUTPUT_END} noise ${STRUCTURED_OUTPUT_BEGIN}{"new":true}${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"new":true}');
    });

    it("throws OutputParseError when BEGIN delimiter is missing", () => {
      expect(() => parser.extractStructuredBlock("no markers here")).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock("no markers here");
        expect.unreachable();
      } catch (err) {
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      }
    });

    it("throws OutputParseError when END delimiter is missing after BEGIN", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}{"a":1}`;
      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
      }
    });
  });

  describe("parseJson", () => {
    it("parses valid JSON", () => {
      expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it("throws OutputParseError with raw context on invalid JSON", () => {
      try {
        parser.parseJson("not json");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("Failed to parse JSON");
        expect((err as OutputParseError).rawOutput).toBe("not json");
      }
    });
  });

  describe("validate", () => {
    const schema = z.object({ name: z.string() });

    it("returns the parsed data when valid", () => {
      expect(parser.validate({ name: "x" }, schema)).toEqual({ name: "x" });
    });

    it("throws OutputParseError listing field issues when invalid", () => {
      try {
        parser.validate({ name: 42 }, schema);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("name");
        expect((err as OutputParseError).message).toContain("Structured output failed schema validation");
      }
    });
  });

  describe("parse", () => {
    const schema = z.object({ name: z.string() });

    it("extracts, parses, and validates in one pass", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}{"name":"ok"}${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ name: "ok" });
    });

    it("propagates extraction failure", () => {
      expect(() => parser.parse("no markers", schema)).toThrow(OutputParseError);
    });

    it("propagates validation failure for schema mismatch", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}{"name":42}${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });
  });
});
