import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

const schema = z.object({ ok: z.boolean(), name: z.string() });

describe("OutputParser.extractStructuredBlock", () => {
  it("extracts the trimmed content between the BEGIN and END markers", () => {
    const parser = new OutputParser();
    const raw = `preamble\n${STRUCTURED_OUTPUT_BEGIN}\n  {"ok":true}  \n${STRUCTURED_OUTPUT_END}\ntrailer`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });

  it("uses the LAST BEGIN marker when there are multiple", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":false}\n${STRUCTURED_OUTPUT_END}\nnoise\n${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"ok":true}');
  });

  it("throws OutputParseError with a tail snippet when BEGIN marker is missing", () => {
    const parser = new OutputParser();
    const raw = "just some chatty output with no markers at all";
    expect(() => parser.extractStructuredBlock(raw)).toThrow(OutputParseError);
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toBe(raw.slice(-500));
    }
  });

  it("throws OutputParseError when BEGIN is present but END is missing", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n{"ok":true}\nno end here`;
    try {
      parser.extractStructuredBlock(raw);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain(STRUCTURED_OUTPUT_END);
      expect(e.message).toContain(STRUCTURED_OUTPUT_BEGIN);
      expect(e.rawOutput).toContain('{"ok":true}');
    }
  });
});

describe("OutputParser.parseJson", () => {
  it("parses valid JSON", () => {
    const parser = new OutputParser();
    expect(parser.parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws OutputParseError with a head snippet on invalid JSON", () => {
    const parser = new OutputParser();
    const bad = "{not valid json";
    try {
      parser.parseJson(bad);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Failed to parse JSON");
      expect(e.rawOutput).toBe(bad.slice(0, 500));
    }
  });
});

describe("OutputParser.validate", () => {
  it("returns the parsed data when it matches the schema", () => {
    const parser = new OutputParser();
    const data = { ok: true, name: "x" };
    expect(parser.validate(data, schema)).toEqual(data);
  });

  it("throws OutputParseError with issue paths when validation fails", () => {
    const parser = new OutputParser();
    const data = { ok: "not-a-bool", name: 5 };
    try {
      parser.validate(data, schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OutputParseError);
      const e = err as OutputParseError;
      expect(e.message).toContain("Structured output failed schema validation");
      expect(e.message).toContain("ok:");
      expect(e.message).toContain("name:");
      expect(e.rawOutput).toBe(JSON.stringify(data).slice(0, 500));
    }
  });
});

describe("OutputParser.parse (end-to-end)", () => {
  it("extracts, parses and validates a full structured payload", () => {
    const parser = new OutputParser();
    const raw = `chatter\n${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ ok: true, name: "abc" })}\n${STRUCTURED_OUTPUT_END}`;
    expect(parser.parse(raw, schema)).toEqual({ ok: true, name: "abc" });
  });

  it("propagates the extraction error when markers are absent", () => {
    const parser = new OutputParser();
    expect(() => parser.parse("no markers here", schema)).toThrow(OutputParseError);
  });

  it("propagates the JSON parse error for a malformed block", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\nnot json\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/Failed to parse JSON/);
  });

  it("propagates the schema validation error for a well-formed but invalid payload", () => {
    const parser = new OutputParser();
    const raw = `${STRUCTURED_OUTPUT_BEGIN}\n${JSON.stringify({ ok: 1 })}\n${STRUCTURED_OUTPUT_END}`;
    expect(() => parser.parse(raw, schema)).toThrow(/failed schema validation/);
  });
});
