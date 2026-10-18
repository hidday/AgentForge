import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type ParsedBlock } from "./parseClaudeOutput";

describe("parseClaudeOutput – additional branch coverage", () => {
  it("filters a non-JSON fragment matching only the stop_reason/stop_sequence noise pattern", () => {
    // Deliberately avoids the other noise patterns (no input_tokens/other
    // metadata keywords, no parent_tool_use_id+session_id) so this exercises
    // the dedicated stop_reason/stop_sequence check specifically.
    const fragment = 'foo":"bar"},"stop_reason":null,"stop_sequence":null}';
    expect(parseClaudeOutput(fragment)).toEqual([]);
  });

  it("skips null/non-object entries within a content array without throwing", () => {
    const line = JSON.stringify([
      null,
      { type: "text", text: "after the null" },
    ]);
    const result = parseClaudeOutput(line);
    expect(result).toEqual<ParsedBlock[]>([{ type: "text", content: "after the null" }]);
  });

  it("stringifies an object tool_result content field from a content array entry", () => {
    const line = JSON.stringify([
      { type: "tool_result", content: { exitCode: 1, message: "failed" }, is_error: true },
    ]);
    const result = parseClaudeOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tool_result");
    expect(result[0].isError).toBe(true);
    expect(JSON.parse(result[0].content)).toEqual({ exitCode: 1, message: "failed" });
  });

  it("stringifies a non-string, non-object tool_result content field via String()", () => {
    const line = JSON.stringify([{ type: "tool_result", content: 42, is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("42");
  });

  it("falls back to an empty string tool_result content when content is missing entirely", () => {
    const line = JSON.stringify([{ type: "tool_result", is_error: false }]);
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("returns an empty tool_use input summary when input is null", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "NoInput", input: null }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("returns an empty tool_use input summary when input is a non-object primitive", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "WeirdInput", input: "not-an-object" }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("");
  });

  it("uses the 'path' input field when command/file_path are absent", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Glob", input: { path: "/some/dir" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("/some/dir");
  });

  it("returns short tool_use content verbatim without truncation", () => {
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Write", input: { content: "short text" } }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content).toBe("short text");
  });

  it("produces no block for a line that parses as a non-object JSON primitive", () => {
    // Valid JSON ("true") that is neither an array nor an object, so it is
    // silently dropped rather than treated as a raw/noise fallback line.
    expect(parseClaudeOutput("true")).toEqual([]);
  });

  it("produces no block for a tool_use_result that is neither a string nor an object", () => {
    const line = JSON.stringify({ tool_use_result: 42 });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block for a content_block_start whose content_block is not a tool_use", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "not a tool" },
    });
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("produces no block for a content-array entry with an unrecognized type", () => {
    const line = JSON.stringify([{ type: "thinking", text: "pondering..." }]);
    expect(parseClaudeOutput(line)).toEqual([]);
  });

  it("truncates a long JSON-summary fallback for tool input with no known fields", () => {
    const bigObj: Record<string, string> = {};
    for (let i = 0; i < 30; i++) bigObj[`field${i}`] = "value-value-value";
    const line = JSON.stringify({
      content: [{ type: "tool_use", name: "Custom", input: bigObj }],
    });
    const result = parseClaudeOutput(line);
    expect(result[0].content.length).toBe(201);
    expect(result[0].content.endsWith("…")).toBe(true);
  });
});
