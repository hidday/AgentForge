import { describe, it, expect } from "vitest";
import { parseClaudeOutput } from "./parseClaudeOutput.ts";

describe("parseClaudeOutput (gaps)", () => {
  it("produces no block for a top-level JSON value that is a primitive (not an object or array)", () => {
    expect(parseClaudeOutput("42")).toEqual([]);
    expect(parseClaudeOutput('"just a string"')).toEqual([]);
    expect(parseClaudeOutput("true")).toEqual([]);
  });

  it("produces no block when tool_use_result is neither a string nor an object", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block when tool_use_result is null", () => {
    const line = JSON.stringify({ tool_use_result: null });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block for a content_block_start whose content_block is not a tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block for a content_block_start whose tool_use content_block has a non-string name", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: 42 },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("skips non-object entries inside a content array", () => {
    const line = JSON.stringify({
      content: ["a plain string entry", 42, null, { type: "text", text: "real text" }],
    });
    const result = parseClaudeOutput(line);
    expect(result).toEqual([{ type: "text", content: "real text" }]);
  });

  it("produces no block for a content array entry whose type is unrecognized", () => {
    const line = JSON.stringify({
      content: [{ type: "thinking", thinking: "internal reasoning" }],
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("stringifies a tool_result's object content via JSON.stringify", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: { ok: true, count: 3 } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].type).toBe("tool_result");
    expect(result[0].content).toBe(JSON.stringify({ ok: true, count: 3 }));
  });

  it("stringifies a tool_result's non-string, non-object content via String()", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: 404 }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("404");
  });

  it("stringifies a null tool_result content via JSON.stringify (typeof null === 'object')", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result", content: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("null");
  });

  it("falls back to an empty string for a tool_result with no content field at all", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_result" }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("formatToolInput returns an empty string when the tool_use input is not an object (via a content array entry)", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Weird", input: "not an object" }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("formatToolInput returns an empty string when input is null", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Weird", input: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("formatToolInput falls back to obj.path when command/file_path are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/some/dir" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("/some/dir");
  });

  it("formatToolInput falls back to obj.query when command/file_path/path are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Search", input: { query: "find this" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("find this");
  });

  it("does not truncate a short tool input content string", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short content" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("short content");
  });

  it("truncates a large JSON summary fallback (object with no known fields) with an ellipsis", () => {
    const bigObject: Record<string, string> = {};
    for (let i = 0; i < 40; i++) bigObject[`field${i}`] = "value".repeat(3);
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigObject }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toHaveLength(201);
    expect(result[0].content.endsWith("…")).toBe(true);
  });

  it("filters a non-JSON partial line containing stop_reason:null and stop_sequence:null but no other noise markers", () => {
    // Deliberately invalid/incomplete JSON (an SSE chunk boundary fragment)
    // with neither token-metadata keywords nor parent_tool_use_id/session_id,
    // so it must be caught by the dedicated stop_reason/stop_sequence check.
    const fragment = 'oo"}],"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });
});
