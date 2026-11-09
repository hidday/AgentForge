import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput";

describe("parseClaudeOutput – isNoiseLine stop_reason/stop_sequence fragment", () => {
  it("treats a non-JSON fragment containing null stop_reason and stop_sequence as noise", () => {
    const line = '"stop_reason": null, "stop_sequence": null';
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("does not treat a fragment with only stop_reason:null (no stop_sequence) as noise", () => {
    const line = '"stop_reason": null, something else';
    expect(parseClaudeOutput(line)).toEqual([{ type: "raw", content: line }]);
  });
});

describe("parseClaudeOutput – formatToolInput branches", () => {
  it("uses the path field when present (no command/file_path/query/content)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/tmp/project" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toEqual({ type: "tool_use", content: "/tmp/project", toolName: "Glob" });
  });

  it("returns an empty string for non-object tool input", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Noop", input: "not-an-object" }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toEqual({ type: "tool_use", content: "", toolName: "Noop" });
  });

  it("returns an empty string for null tool input", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Noop", input: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toEqual({ type: "tool_use", content: "", toolName: "Noop" });
  });

  it("truncates the JSON fallback summary when it exceeds 200 characters", () => {
    const input = { unknownField: "y".repeat(250) };
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toHaveLength(201);
    expect((result[0].content as string).endsWith("…")).toBe(true);
  });

  it("returns short content as-is without truncation", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0]).toEqual({ type: "tool_use", content: "short", toolName: "Write" });
  });
});

describe("parseClaudeOutput – extractFromContentArray branches", () => {
  it("skips non-object entries (null, primitives) within a content array", () => {
    const line = JSON.stringify({
      content: [null, "a plain string", 42, { type: "text", text: "kept" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "text", content: "kept" }]);
  });

  it("extracts a tool_result entry from a content array with string content", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: "file.txt", is_error: false }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_result", content: "file.txt", isError: false }]);
  });

  it("extracts an errored tool_result entry with object content from a content array", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: { code: 1 }, is_error: true }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([
      { type: "tool_result", content: JSON.stringify({ code: 1 }), isError: true },
    ]);
  });

  it("stringifies a primitive (non-string, non-object) tool_result content from a content array", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: 42, is_error: false }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_result", content: "42", isError: false }]);
  });

  it("falls back to an empty string for a missing tool_result content field", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", is_error: false }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "tool_result", content: "", isError: false }]);
  });

  it("ignores a content array entry whose type matches none of text/tool_use/tool_result", () => {
    const line = JSON.stringify({
      content: [{ type: "unknown_block" }, { type: "text", text: "kept" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "text", content: "kept" }]);
  });
});

describe("parseClaudeOutput – top-level object branches", () => {
  it("ignores a top-level tool_use_result that is neither a string nor an object", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("ignores a content_block_start whose content_block is not a tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "ignored" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });
});
