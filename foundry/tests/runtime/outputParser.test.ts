import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({
  success: z.boolean(),
  value: z.string(),
});

describe("OutputParser.extractStructuredBlock", () => {
  const parser = new OutputParser();

  it("throws OutputParseError when the BEGIN delimiter is absent", () => {
    const raw = "just some chatty output with no markers at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(`Could not find "${STRUCTURED_OUTPUT_BEGIN}"`);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"value":"x"}\nno closing marker here`;
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(`Found "${STRUCTURED_OUTPUT_BEGIN}"`);
      expect(e.message).toContain(`no matching "${STRUCTURED_OUTPUT_END}"`);
      const beginIdx = raw.indexOf(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(beginIdx, beginIdx + 500));
    }
  });

  it("extracts and trims the block between the last BEGIN and its following END", () => {
    const raw = [
      `${STRUCTURED_OUTPUT_BEGIN}`,
      `{"success":false,"value":"stale"}`,
      `${STRUCTURED_OUTPUT_END}`,
      "some interleaved chatter",
      `${STRUCTURED_OUTPUT_BEGIN}`,
      `  {"success":true,"value":"fresh"}  `,
      `${STRUCTURED_OUTPUT_END}`,
      "trailing text",
    ].join("\n");

    const block = parser.extractStructuredBlock(raw);
    expect(block).toBe('{"success":true,"value":"fresh"}');
  });
});

describe("OutputParser.parseJson", () => {
  const parser = new OutputParser();

  it("parses valid JSON", () => {
    expect(parser.parseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("throws OutputParseError with a descriptive message on malformed JSON", () => {
    const block = "{not valid json,,,";
    try {
      parser.parseJson(block);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON:");
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });

  it("falls back to String(err) when the underlying parser throws a non-Error value", () => {
    const originalParse = JSON.parse;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (JSON as any).parse = () => {
      // eslint-disable-next-line no-throw-literal
      throw "not-an-error-instance";
    };
    try {
      try {
        parser.parseJson("{}");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OutputParseError);
        expect((err as OutputParseError).message).toBe(
          "Failed to parse JSON: not-an-error-instance",
        );
      }
    } finally {
      JSON.parse = originalParse;
    }
  });

  it("truncates a very long malformed block to 500 chars in rawOutput", () => {
    const block = "{" + "x".repeat(900);
    try {
      parser.parseJson(block);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.rawOutput?.length).toBe(500);
      expect(e.rawOutput).toBe(block.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  const parser = new OutputParser();

  it("returns validated data when it conforms to the schema", () => {
    const data = { success: true, value: "ok" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with per-field issue lines when validation fails", () => {
    const data = { success: "not-a-boolean", value: 42 };
    try {
      parser.validate(data, schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation:");
      expect(e.message).toContain("success:");
      expect(e.message).toContain("value:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });

  it("reports nested paths for issues inside nested objects", () => {
    const nestedSchema = z.object({ outer: z.object({ inner: z.number() }) });
    try {
      parser.validate({ outer: { inner: "nope" } }, nestedSchema);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as OutputParseError;
      expect(e.message).toContain("outer.inner:");
    }
  });
});

describe("OutputParser.parse (integration)", () => {
  const parser = new OutputParser();

  it("extracts, parses, and validates a well-formed structured block end-to-end", () => {
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"value":"ok"}\n${STRUCTURED_OUTPUT_END}\ntrailer`;
    const result = parser.parse(raw, schema);
    expect(result).toEqual({ success: true, value: "ok" });
  });

  it("propagates OutputParseError from extraction when delimiters are missing", () => {
    expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
  });

  it("propagates OutputParseError from JSON parsing when the block is malformed", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates OutputParseError from schema validation when fields are wrong", () => {
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"success":"nope"}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
