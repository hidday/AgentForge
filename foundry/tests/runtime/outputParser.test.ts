import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

describe("OutputParser", () => {
  const parser = new OutputParser();

  describe("extractStructuredBlock", () => {
    it("extracts and trims the block between well-formed delimiters", () => {
      const raw = `some preamble noise\n${STRUCTURED_OUTPUT_BEGIN}\n  {"a":1}  \n${STRUCTURED_OUTPUT_END}\ntrailing noise`;
      const result = parser.extractStructuredBlock(raw);
      expect(result).toBe('{"a":1}');
    });

    it("handles noise both before and after the structured payload", () => {
      const raw = `garbage garbage garbage\n${STRUCTURED_OUTPUT_BEGIN}\npayload-content\n${STRUCTURED_OUTPUT_END}\nmore garbage after`;
      const result = parser.extractStructuredBlock(raw);
      expect(result).toBe("payload-content");
    });

    it("throws OutputParseError when the begin delimiter is missing entirely", () => {
      const raw = "no delimiters here at all";
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toBe(`Could not find "${STRUCTURED_OUTPUT_BEGIN}" delimiter in output`);
        expect(e.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("truncates rawOutput to the last 500 chars when begin delimiter is missing on long output", () => {
      const raw = "x".repeat(1000);
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("expected throw");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput).toHaveLength(500);
        expect(e.rawOutput).toBe(raw.slice(-500));
      }
    });

    it("throws OutputParseError when begin is found but end delimiter is missing (truncated output)", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"a":1} truncated stream cuts off here`;
      expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
      try {
        parser.extractStructuredBlock(raw);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toBe(
          `Found "${STRUCTURED_OUTPUT_BEGIN}" but no matching "${STRUCTURED_OUTPUT_END}" delimiter`,
        );
        const beginIdx = raw.indexOf(STRUCTURED_OUTPUT_BEGIN);
        expect(e.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
      }
    });

    it("throws OutputParseError on completely empty output", () => {
      try {
        parser.extractStructuredBlock("");
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toBe(`Could not find "${STRUCTURED_OUTPUT_BEGIN}" delimiter in output`);
        expect(e.rawOutput).toBe("");
      }
    });

    it("uses the LAST begin delimiter when multiple are present (lastIndexOf)", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\nSTALE\n${STRUCTURED_OUTPUT_END}\nnoise\n${STRUCTURED_OUTPUT_BEGIN}\nFRESH\n${STRUCTURED_OUTPUT_END}`;
      const result = parser.extractStructuredBlock(raw);
      expect(result).toBe("FRESH");
    });

    it("does not match an END delimiter occurring before the (last) BEGIN delimiter", () => {
      // An END token appears before BEGIN in the raw text (e.g. leftover from prior stage);
      // extraction must search for END only after BEGIN, so it should find the later END.
      const raw = `${STRUCTURED_OUTPUT_END}\nsome text\n${STRUCTURED_OUTPUT_BEGIN}\nREAL\n${STRUCTURED_OUTPUT_END}`;
      const result = parser.extractStructuredBlock(raw);
      expect(result).toBe("REAL");
    });
  });

  describe("parseJson", () => {
    it("parses well-formed JSON", () => {
      const result = parser.parseJson('{"foo":"bar","n":42}');
      expect(result).toEqual({ foo: "bar", n: 42 });
    });

    it("throws OutputParseError with details for malformed JSON", () => {
      const block = "{not valid json";
      try {
        parser.parseJson(block);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toMatch(/^Failed to parse JSON: /);
        expect(e.rawOutput).toBe(block.slice(0, 500));
      }
    });

    it("throws OutputParseError for empty string input", () => {
      try {
        parser.parseJson("");
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toMatch(/^Failed to parse JSON: /);
        expect(e.rawOutput).toBe("");
      }
    });

    it("truncates rawOutput to the first 500 chars of a long malformed block", () => {
      const block = "{" + "x".repeat(1000);
      try {
        parser.parseJson(block);
        expect.fail("expected throw");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput).toHaveLength(500);
        expect(e.rawOutput).toBe(block.slice(0, 500));
      }
    });

    it("stringifies a non-Error thrown value via String(err) in the message", () => {
      const spy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "not-an-error-instance";
      });
      try {
        expect(() => parser.parseJson('{"a":1}')).toThrow(
          "Failed to parse JSON: not-an-error-instance",
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("validate", () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it("returns parsed data when it satisfies the schema", () => {
      const data = { name: "Ada", age: 30 };
      const result = parser.validate(data, schema);
      expect(result).toEqual({ name: "Ada", age: 30 });
    });

    it("throws OutputParseError with joined issue paths and messages on validation failure", () => {
      const data = { name: "Ada", age: "thirty" };
      try {
        parser.validate(data, schema);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        const e = err as OutputParseError;
        expect(e.message).toContain("Structured output failed schema validation:");
        expect(e.message).toContain("age:");
        expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });

    it("truncates rawOutput to 500 chars for a large invalid payload", () => {
      const data = { name: "x".repeat(1000), age: "not-a-number" };
      try {
        parser.validate(data, schema);
        expect.fail("expected throw");
      } catch (err) {
        const e = err as OutputParseError;
        expect(e.rawOutput).toHaveLength(500);
        expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
      }
    });
  });

  describe("parse (end-to-end)", () => {
    const schema = z.object({ ok: z.boolean() });

    it("extracts, parses, and validates a well-formed structured output end-to-end", () => {
      const raw = `CLI startup logs...\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}\ndone.`;
      const result = parser.parse(raw, schema);
      expect(result).toEqual({ ok: true });
    });

    it("propagates the extraction failure when delimiters are absent", () => {
      expect(() => parser.parse("nothing structured here", schema)).toThrow(
        `Could not find "${STRUCTURED_OUTPUT_BEGIN}" delimiter in output`,
      );
    });

    it("propagates the JSON parse failure for a malformed block", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{not json\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow(/^Failed to parse JSON: /);
    });

    it("propagates the schema validation failure for well-formed JSON that doesn't match the schema", () => {
      const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":"not-a-boolean"}\n${STRUCTURED_OUTPUT_END}`;
      expect(() => parser.parse(raw, schema)).toThrow("Structured output failed schema validation:");
    });
  });
});
