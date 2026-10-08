import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OutputParser } from "../../src/runtime/outputParser.js";
import { OutputParseError } from "../../src/utils/errors.js";
import {
  STRUCTURED_OUTPUT_BEGIN as BEGIN,
  STRUCTURED_OUTPUT_END as END,
} from "../../src/schemas/cliProtocol.js";

const parser = new OutputParser();

function catchErr(fn: () => unknown): OutputParseError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OutputParseError);
    return e as OutputParseError;
  }
  throw new Error("expected function to throw");
}

describe("OutputParser.extractStructuredBlock", () => {
  it("returns the trimmed content between the delimiters", () => {
    expect(parser.extractStructuredBlock(`noise\n${BEGIN}\n  {"a":1}  \n${END}\ntrailer`)).toBe(
      '{"a":1}',
    );
  });

  it("uses the LAST begin delimiter when the output echoes the protocol earlier", () => {
    const raw = `${BEGIN} example ${END}\n...\n${BEGIN}{"real":true}${END}`;
    expect(parser.extractStructuredBlock(raw)).toBe('{"real":true}');
  });

  it("throws with the last 500 chars as rawOutput when the begin delimiter is missing", () => {
    const raw = "a".repeat(100) + "b".repeat(500);
    const err = catchErr(() => parser.extractStructuredBlock(raw));
    expect(err.message).toBe(`Could not find "${BEGIN}" delimiter in output`);
    expect(err.rawOutput).toBe("b".repeat(500));
  });

  it("throws with a snippet starting at the begin delimiter when the end delimiter is missing", () => {
    const raw = `prefix ${BEGIN}{"a":1}` + "z".repeat(600);
    const err = catchErr(() => parser.extractStructuredBlock(raw));
    expect(err.message).toBe(`Found "${BEGIN}" but no matching "${END}" delimiter`);
    expect(err.rawOutput).toHaveLength(500);
    expect(err.rawOutput?.startsWith(`${BEGIN}{"a":1}`)).toBe(true);
  });

  it("ignores an END that only appears before the last BEGIN", () => {
    const raw = `${END} ${BEGIN} {"a":1}`;
    expect(() => parser.extractStructuredBlock(raw)).toThrow(/no matching/);
  });
});

describe("OutputParser.parseJson", () => {
  it("parses valid JSON", () => {
    expect(parser.parseJson('{"x":[1,2]}')).toEqual({ x: [1, 2] });
  });

  it("wraps JSON syntax errors with the first 500 chars of the block", () => {
    const block = "{not json" + "y".repeat(600);
    const err = catchErr(() => parser.parseJson(block));
    expect(err.message).toMatch(/^Failed to parse JSON: /);
    expect(err.rawOutput).toBe(block.slice(0, 500));
  });
});

describe("OutputParser.validate", () => {
  const schema = z.object({ name: z.string(), nested: z.object({ n: z.number() }) });

  it("returns the parsed data when it matches the schema", () => {
    expect(parser.validate({ name: "a", nested: { n: 1 } }, schema)).toEqual({
      name: "a",
      nested: { n: 1 },
    });
  });

  it("lists every issue with its dotted path", () => {
    const data = { name: 5, nested: { n: "x" } };
    const err = catchErr(() => parser.validate(data, schema));
    expect(err.message.startsWith("Structured output failed schema validation:\n")).toBe(true);
    expect(err.message).toContain("  name: Expected string, received number");
    expect(err.message).toContain("  nested.n: Expected number, received string");
    expect(err.rawOutput).toBe(JSON.stringify(data));
  });

  it("truncates rawOutput to 500 chars for large payloads", () => {
    const err = catchErr(() => parser.validate({ name: "q".repeat(1000) }, schema));
    expect(err.rawOutput).toHaveLength(500);
  });
});

describe("OutputParser.parse", () => {
  const schema = z.object({ ok: z.boolean() });

  it("extracts, parses and validates end-to-end", () => {
    expect(parser.parse(`log\n${BEGIN}{"ok":true}${END}`, schema)).toEqual({ ok: true });
  });

  it("surfaces each stage's failure", () => {
    expect(() => parser.parse("nothing", schema)).toThrow(/Could not find/);
    expect(() => parser.parse(`${BEGIN}{bad${END}`, schema)).toThrow(/Failed to parse JSON/);
    expect(() => parser.parse(`${BEGIN}{"ok":"yes"}${END}`, schema)).toThrow(
      /failed schema validation/,
    );
  });
});
