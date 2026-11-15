import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("extracts and trims the content between the delimiters", () => {
      const raw = `noise\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\nmore noise`;
      expect(parser.extractStructuredBlock(raw)).toBe('{"a":1}');
    });

    it("throws OutputParseError when the begin delimiter is missing", () => {
      expect(() => parser.extractStructuredBlock("no markers here")).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock("no markers here");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_BEGIN);
      }
    });

    it("throws OutputParseError when the end delimiter is missing after the begin delimiter", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1}`;
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
      } catch (err) {
        expect((err as OutputParseError).message).toContain(STRUCTURED_OUTPUT_END);
        expect((err as OutputParseError).rawOutput).toContain(STRUCTURED_OUTPUT_BEGIN);
      }
    });

    it("uses the last begin marker when there are several (picks the final structured block)", () => {
      const raw = [
        `${STRUCTURED_OUTPUT_BEGIN}`,
        `{"old":true}`,
        `${STRUCTURED_OUTPUT_END}`,
        `some agent chatter`,
        `${STRUCTURED_OUTPUT_BEGIN}`,
        `{"new":true}`,
        `${STRUCTURED_OUTPUT_END}`,
      ].join("\n");
      expect(parser.extractStructuredBlock(raw)).toBe('{"new":true}');
    });

    it("includes a tail slice of raw output in the error when the begin marker is absent", () => {
      const raw = "x".repeat(600);
      try {
        parser.extractStructuredBlock(raw);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as OutputParseError).rawOutput).toHaveLength(500);
      }
    });
  });

  describe("parseJson", () => {
    it("parses a valid JSON block", () => {
      expect(parser.parseJson('{"foo":"bar"}')).toEqual({ foo: "bar" });
    });

    it("throws OutputParseError with the underlying message when JSON is malformed", () => {
      try {
        parser.parseJson("{not valid json");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toContain("Failed to parse JSON");
        expect((err as OutputParseError).rawOutput).toBe("{not valid json");
      }
    });
  });

  describe("validate", () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it("returns the parsed data when it matches the schema", () => {
      const data = { name: "a", age: 1 };
      expect(parser.validate(data, schema)).toEqual(data);
    });

    it("throws OutputParseError listing every validation issue by path", () => {
      try {
        parser.validate({ name: 1, age: "old" }, schema);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const message = (err as OutputParseError).message;
        expect(message).toContain("name:");
        expect(message).toContain("age:");
      }
    });
  });

  describe("parse", () => {
    const schema = z.object({ ok: z.boolean() });

    it("runs extraction, JSON parsing, and schema validation end to end", () => {
      const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
      expect(parser.parse(raw, schema)).toEqual({ ok: true });
    });

    it("propagates the extraction error when no delimiters are present", () => {
      expect(() => parser.parse("nothing here", schema)).toThrow(OutputParseError);
    });

    it("propagates the schema validation error for a structurally valid but schema-invalid block", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":"not-a-boolean"}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(OutputParseError);
    });
  });
});
