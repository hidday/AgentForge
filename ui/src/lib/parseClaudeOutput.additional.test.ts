import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput";

describe("parseClaudeOutput – stop_reason/stop_sequence noise without other markers", () => {
  it("drops a non-JSON fragment that only matches the stop_reason/stop_sequence null pattern", () => {
    // Deliberately excludes any token-metadata keywords and the
    // parent_tool_use_id+session_id combo, so this line reaches the
    // stand-alone stop_reason/stop_sequence check in isNoiseLine and is
    // invalid JSON so it isn't parsed as a real object first.
    const fragment = ',"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("keeps a fragment with only stop_reason:null (no stop_sequence) as raw content", () => {
    const fragment = ',"stop_reason":null,"other_field":"value"}';
    const result = parseClaudeOutput(fragment);
    expect(result).toEqual<ParsedBlock[]>([{ type: "raw", content: fragment }]);
  });
});

describe("parseClaudeOutput – non-object / null entries inside a content array", () => {
  it("skips null entries in a bare content array without breaking extraction of the rest", () => {
    const line = JSON.stringify([null, { type: "text", text: "hello" }]);
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "hello" }]);
  });

  it("skips primitive (non-object) entries in a content array", () => {
    const line = JSON.stringify(["a string entry", 42, { type: "text", text: "after" }]);
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "after" }]);
  });
});

describe("parseClaudeOutput – formatToolInput edge cases", () => {
  it("returns an empty string when tool_use input is not an object (e.g. omitted)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NoInput" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "", toolName: "NoInput" },
    ]);
  });

  it("returns an empty string when tool_use input is explicitly null", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NullInput", input: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("uses the `path` field when command/file_path are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/src" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "/src", toolName: "Glob" },
    ]);
  });

  it("does not truncate short content-field input", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("short");
  });

  it("does not truncate a short JSON summary fallback", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: { a: 1 } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe(JSON.stringify({ a: 1 }));
    expect(result[0].content.endsWith("…")).toBe(false);
  });

  it("truncates a long JSON summary fallback with an ellipsis", () => {
    const bigInput: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      bigInput[`field_${i}`] = `value_${i}_padding_padding`;
    }
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigInput }],
    });
    const result = parseClaudeOutput(line);
    expect(JSON.stringify(bigInput).length).toBeGreaterThan(200);
    expect(result[0].content).toHaveLength(201);
    expect(result[0].content.endsWith("…")).toBe(true);
  });
});

describe("parseClaudeOutput – top-level JSON values that are not arrays or objects", () => {
  it("produces no blocks for a bare JSON number line", () => {
    expect(parseClaudeOutput("42")).toEqual([]);
  });

  it("produces no blocks for a bare JSON string line", () => {
    expect(parseClaudeOutput('"just a string"')).toEqual([]);
  });
});

describe("parseClaudeOutput – tool_use_result that is neither a string nor a non-null object", () => {
  it("produces no block when tool_use_result is null", () => {
    const line = JSON.stringify({ tool_use_result: null });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block when tool_use_result is a number", () => {
    const line = JSON.stringify({ tool_use_result: 7 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – content_block_start with a non-tool_use content_block", () => {
  it("does not emit a block when the content_block type is not tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – content array entries with an unrecognised type", () => {
  it("skips entries whose type is neither text, tool_use, nor tool_result", () => {
    const line = JSON.stringify({
      content: [{ type: "thinking", thinking: "internal reasoning" }],
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – tool_result content that is not a string", () => {
  it("JSON-stringifies an object tool_result content field", () => {
    const line = JSON.stringify([
      { type: "tool_result", content: { code: 1, msg: "bad" }, is_error: true },
    ]);
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      {
        type: "tool_result",
        content: JSON.stringify({ code: 1, msg: "bad" }),
        isError: true,
      },
    ]);
  });

  it("JSON-stringifies a null tool_result content field (typeof null === 'object')", () => {
    const line = JSON.stringify([{ type: "tool_result", content: null, is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "null", isError: false },
    ]);
  });

  it("falls back to an empty string when the tool_result content field is absent entirely", () => {
    // JSON.stringify drops `undefined` properties, so build the raw NDJSON
    // line directly to omit the `content` key and exercise the final
    // `String(entry.content ?? "")` fallback branch.
    const line = '[{"type":"tool_result","is_error":false}]';
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_result", content: "", isError: false },
    ]);
  });
});
