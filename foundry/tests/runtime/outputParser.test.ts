import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ value: z.string(), count: z.number() });

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("extracts the JSON block between the delimiters", () => {
      const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"x","count":1}\n${STRUCTURED_OUTPUT_END}\ntrailer`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"x","count":1}');
    });

    it("uses the LAST begin delimiter when there are multiple", () => {
      const raw = [
        STRUCTURED_OUTPUT_BEGIN,
        '{"value":"old","count":0}',
        STRUCTURED_OUTPUT_END,
        "some chat in between",
        STRUCTURED_OUTPUT_BEGIN,
        '{"value":"new","count":2}',
        STRUCTURED_OUTPUT_END,
      ].join("\n");

      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"new","count":2}');
    });

    it("throws OutputParseError when the begin delimiter is missing", () => {
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

    it("throws OutputParseError when begin is present but end is missing", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"x"}`;
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
      }
    });

    it("trims surrounding whitespace from the extracted block", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n\n  {"value":"x","count":1}  \n\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"x","count":1}');
    });

    it("only searches for the end delimiter after the begin delimiter (not before it)", () => {
      // END appears once, before a later BEGIN — must not be matched against
      // content preceding the (last) BEGIN.
      const raw = `${STRUCTURED_OUTPUT_END}\nnoise\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"a","count":1}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"value":"a","count":1}');
    });
  });

  describe("parseJson", () => {
    it("parses valid JSON", () => {
      expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it("throws OutputParseError with a message and snippet on invalid JSON", () => {
      const bad = "{not json";
      try {
        parser.parseJson(bad);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("Failed to parse JSON");
        expect((err as OutputParseError).rawOutput).toBe(bad.slice(0, 500));
      }
    });

    it("truncates the raw output snippet to 500 chars on parse failure", () => {
      const bad = "x".repeat(1000);
      try {
        parser.parseJson(bad);
        expect.unreachable();
      } catch (err) {
        expect((err as OutputParseError).rawOutput?.length).toBe(500);
      }
    });
  });

  describe("validate", () => {
    it("returns the parsed data when it matches the schema", () => {
      const result = parser.validate({ value: "x", count: 1 }, schema);
      expect(result).toEqual({ value: "x", count: 1 });
    });

    it("throws OutputParseError listing the validation issues when data doesn't match", () => {
      try {
        parser.validate({ value: 5, count: "nope" }, schema);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const message = (err as OutputParseError).message;
        expect(message).toContain("Structured output failed schema validation");
        expect(message).toContain("value:");
        expect(message).toContain("count:");
      }
    });

    it("includes a JSON snippet of the offending data in the error, truncated to 500 chars", () => {
      const bigString = "z".repeat(1000);
      try {
        parser.validate({ value: bigString, count: "bad" }, schema);
        expect.unreachable();
      } catch (err) {
        const snippet = (err as OutputParseError).rawOutput;
        expect(snippet).toBeDefined();
        expect(snippet!.length).toBe(500);
      }
    });
  });

  describe("parse (end-to-end)", () => {
    it("extracts, parses, and validates a well-formed structured output block", () => {
      const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok","count":7}\n${STRUCTURED_OUTPUT_END}`;
      const result = parser.parse(raw, schema);
      expect(result).toEqual({ value: "ok", count: 7 });
    });

    it("propagates the delimiter error when the block is missing", () => {
      expect(() => parser.parse("no block here", schema)).toThrow(
        /Could not find "BEGIN_STRUCTURED_OUTPUT"/,
      );
    });

    it("propagates the JSON error when the block is malformed JSON", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
    });

    it("propagates the schema validation error when the JSON doesn't match the schema", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"value":"ok"}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
    });
  });
});
