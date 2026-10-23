import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput.ts";

// Additional coverage for formatToolInput's field-selection branches that the
// existing parseClaudeOutput.test.ts and .extra.test.ts don't exercise:
// missing/non-object input, the "path" field, and a content string short
// enough to not be truncated. Supplementary file; existing tests untouched.
describe("parseClaudeOutput – formatToolInput field selection", () => {
  it("returns empty content when the tool_use entry has no input at all", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NoInput" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "", toolName: "NoInput" },
    ]);
  });

  it("uses the 'path' field when present (and no command/file_path/query)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/tmp/dir" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([
      { type: "tool_use", content: "/tmp/dir", toolName: "Glob" },
    ]);
  });

  it("returns a short content string unmodified, without truncation", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("short text");
    expect(result[0].content.endsWith("…")).toBe(false);
  });

  it("truncates the JSON-summary fallback when it exceeds 200 characters", () => {
    const line = JSON.stringify({
      content: [
        { type: "tool_use", name: "Custom", input: { someUnknownField: "x".repeat(300) } },
      ],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toHaveLength(201);
    expect(result[0].content.endsWith("…")).toBe(true);
  });
});

describe("parseClaudeOutput – additional branch coverage", () => {
  it("produces no block for a line that parses as a bare JSON primitive (not an array or object)", () => {
    expect(parseClaudeOutput('"just a string"')).toEqual([]);
    expect(parseClaudeOutput("42")).toEqual([]);
  });

  it("produces no block when tool_use_result is neither a string nor an object (e.g. a number)", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block for a content_block_start event whose content_block isn't a tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips non-object entries within a content array while still processing valid ones", () => {
    const line = JSON.stringify({
      content: [42, null, "a bare string", { type: "text", text: "hi" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "hi" }]);
  });

  it("produces no block for a content-array entry whose type is unrecognized", () => {
    const line = JSON.stringify({
      content: [{ type: "thinking", thinking: "pondering..." }],
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("JSON-stringifies an object tool_result content value", () => {
    const line = JSON.stringify([
      { type: "tool_result", content: { ok: true, count: 3 }, is_error: false },
    ]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe(JSON.stringify({ ok: true, count: 3 }));
  });

  it("stringifies a non-string, non-object tool_result content value via String()", () => {
    const line = JSON.stringify([{ type: "tool_result", content: 42, is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("42");
  });

  it("falls back to an empty string for a tool_result with no content field at all", () => {
    const line = JSON.stringify([{ type: "tool_result", is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });
});
