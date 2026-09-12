import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

// ---------------------------------------------------------------------------
// This file targets branches left uncovered by parseClaudeOutput.test.ts —
// see that file for the primary test suite. Kept separate per repo
// convention so the existing suite is never touched.
// ---------------------------------------------------------------------------

describe("parseClaudeOutput – stop_reason/stop_sequence noise without other markers", () => {
  it("filters a non-JSON fragment whose only noise signal is stop_reason/stop_sequence both null", () => {
    // Deliberately avoids the token-metadata regex, the output_style/
    // claude_code_version markers, and the parent_tool_use_id+session_id
    // pair, so this line can only be classified as noise via the dedicated
    // stop_reason/stop_sequence check.
    const fragment = '"content_index":0,"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });
});

describe("parseClaudeOutput – top-level JSON value that parses but isn't an object", () => {
  // Note: JSON.parse("null") returns null, which the "is JSON valid?" check
  // treats as a parse failure (falsy), so it becomes a raw line instead —
  // it does not exercise this branch. A truthy non-object value like a
  // number does.
  it("ignores a line whose JSON value is a bare number", () => {
    expect(parseClaudeOutput("42")).toEqual([]);
  });

  it("ignores a line whose JSON value is a bare boolean", () => {
    expect(parseClaudeOutput("true")).toEqual([]);
  });
});

describe("parseClaudeOutput – tool_use_result of an unsupported type", () => {
  it("produces no block when tool_use_result is neither a string nor an object", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block when tool_use_result is a boolean", () => {
    const line = JSON.stringify({ tool_use_result: true });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – content_block_start with a non-tool_use block", () => {
  it("produces no block when the started content_block isn't a tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – content arrays with non-object entries", () => {
  it("skips non-object items in a content array but keeps processing valid ones", () => {
    const line = JSON.stringify({
      content: ["a plain string entry", null, { type: "text", text: "kept" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "text", content: "kept" }]);
  });

  it("produces no block for a content-array entry with an unrecognized type", () => {
    const line = JSON.stringify({
      content: [{ type: "thinking", text: "internal reasoning" }],
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});

describe("parseClaudeOutput – tool_result content of non-string shapes", () => {
  it("JSON-stringifies an object tool_result content", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: { ok: true, count: 3 } }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([
      { type: "tool_result", content: JSON.stringify({ ok: true, count: 3 }), isError: false },
    ]);
  });

  it("stringifies a numeric tool_result content", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: 123 }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_result", content: "123", isError: false }]);
  });

  it("JSON-stringifies a null tool_result content (typeof null is 'object')", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_result", content: "null", isError: false }]);
  });

  it("falls back to an empty string when tool_result has no content field at all", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_result", content: "", isError: false }]);
  });
});

describe("parseClaudeOutput – formatToolInput edge cases", () => {
  it("returns an empty string when a tool_use entry has no input at all", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NoInputTool" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_use", content: "", toolName: "NoInputTool" }]);
  });

  it("uses file_path when present and command is absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/example.ts" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]?.content).toBe("/tmp/example.ts");
  });

  it("returns short `content` input fields unmodified (no truncation)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]?.content).toBe("short");
  });

  it("truncates a long JSON summary fallback with an ellipsis", () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 30; i++) input[`field${i}`] = "value-value-value";
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input }],
    });
    const result = parseClaudeOutput(line);
    const summary = JSON.stringify(input);
    expect(summary.length).toBeGreaterThan(200);
    expect(result[0]?.content).toHaveLength(201);
    expect(result[0]?.content.endsWith("…")).toBe(true);
  });
});
